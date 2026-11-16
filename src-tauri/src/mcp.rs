//! Milo as an MCP server, so an AI app (Claude Desktop, Claude Code, ...) can read the calendar
//! and to-dos and, when allowed, add and change them.
//!
//! Started as `milo --mcp` by the AI app: JSON-RPC 2.0, one message per line on stdin and
//! stdout. It opens the same database as the app (WAL, so both can use it at once); the app
//! notices the changes through `PRAGMA data_version` and refreshes.
//!
//! What it may do is her choice in Settings (`ai_access`: off, read, write), checked on every
//! call. Nothing is ever deleted: changes go through the same functions as the app, so earlier
//! versions are kept, and "archive" can be undone from the archive.

use crate::error::{AppError, Result};
use crate::models::*;
use crate::{insights, repo, search};
use chrono::{DateTime, Duration, Local, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use rusqlite::{Connection, Transaction, TransactionBehavior};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};

/// Settings key: "read", "write", or absent/"off".
pub const ACCESS_SETTING: &str = "ai_access";

const PROTOCOL: &str = "2025-06-18";

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
enum Access {
    Off,
    Read,
    Write,
}

fn access(c: &Connection) -> Result<Access> {
    Ok(match repo::get_setting(c, ACCESS_SETTING)?.as_deref() {
        Some("read") => Access::Read,
        Some("write") => Access::Write,
        _ => Access::Off,
    })
}

/// Reads requests from stdin until it closes. Errors go to stderr; stdout carries only replies.
pub fn serve(c: &Connection) -> Result<()> {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => handle(c, &msg),
            Err(e) => Some(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": format!("Not JSON: {e}")}})),
        };
        if let Some(r) = reply {
            writeln!(out, "{r}")?;
            out.flush()?;
        }
    }
    Ok(())
}

/// One message in, at most one reply out (notifications get none).
pub fn handle(c: &Connection, msg: &Value) -> Option<Value> {
    let method = msg.get("method").and_then(Value::as_str)?;
    let id = msg.get("id").cloned()?;
    let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
    let result = match method {
        "initialize" => Ok(json!({
            // The tools used here are the same in every version so far: answer in the client's.
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL),
            "capabilities": {"tools": {"listChanged": false}},
            "serverInfo": {"name": "milo", "title": "Milo", "version": env!("CARGO_PKG_VERSION")},
            "instructions": INSTRUCTIONS,
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tools()})),
        "tools/call" => Ok(call(c, &params)),
        _ => Err(format!("Unknown method: {method}")),
    };
    Some(match result {
        Ok(r) => json!({"jsonrpc": "2.0", "id": id, "result": r}),
        Err(m) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": m}}),
    })
}

const INSTRUCTIONS: &str = "Milo is the personal planner of a student: a calendar of events (classes, study blocks, \
sleep) in spaces such as courses, and to-dos with steps and deadlines. Call get_overview first to learn today's date, \
the time zone and the names of spaces. All times are local; write them as 2026-11-17T14:00 (or 2026-11-17 for a whole \
day). Use names of spaces, never invent ids; ids come from earlier results. Keep changes small and say what you changed. \
Nothing is deleted: archive puts something in Milo's archive, where it can be restored.";

fn call(c: &Connection, params: &Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    match run(c, name, &args) {
        Ok(v) => json!({"content": [{"type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default()}], "isError": false}),
        Err(e) => json!({"content": [{"type": "text", "text": e.to_string()}], "isError": true}),
    }
}

const WRITES: &[&str] = &["add_event", "change_event", "add_todo", "change_todo", "archive"];

fn run(c: &Connection, name: &str, a: &Value) -> Result<Value> {
    if !tools().iter().any(|t| t["name"] == name) {
        return Err(invalid(format!("Milo has no tool called {name}")));
    }
    let level = access(c)?;
    if level == Access::Off {
        return Err(invalid("Milo does not allow AI apps right now. This can be changed in Milo › Settings › Connect AI."));
    }
    if !WRITES.contains(&name) {
        return read(c, name, a);
    }
    if level < Access::Write {
        return Err(invalid("Milo allows reading only. To let AI apps add and change things, choose \"Read and change\" in Milo › Settings › Connect AI."));
    }
    // All or nothing, and taken at once so the app never sees half a change.
    let tx = Transaction::new_unchecked(c, TransactionBehavior::Immediate)?;
    let v = write(&tx, name, a)?;
    tx.commit()?;
    Ok(v)
}

fn invalid(s: impl Into<String>) -> AppError {
    AppError::Invalid(s.into())
}

// ---------- the tools ----------

fn tools() -> Vec<Value> {
    let read = |title: &str| json!({"title": title, "readOnlyHint": true, "openWorldHint": false});
    let write = |title: &str| json!({"title": title, "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false});
    let s = |d: &str| json!({"type": "string", "description": d});
    vec![
        json!({
            "name": "get_overview",
            "description": "Start here. Today's date and time, the time zone, every space (courses, lists, time-only spaces) with its group and the parts of each course, and the activities events can have.",
            "inputSchema": {"type": "object", "properties": {}},
            "annotations": read("Overview of Milo"),
        }),
        json!({
            "name": "get_calendar",
            "description": "Events from a day to a day (both included), oldest first: classes, study blocks, sleep and more, with space, room and notes.",
            "inputSchema": {"type": "object", "properties": {
                "from": s("First day, like 2026-11-17"),
                "to": s("Last day, included. Defaults to the first day."),
                "space": s("Only this space (name)"),
            }, "required": ["from"]},
            "annotations": read("Read the calendar"),
        }),
        json!({
            "name": "get_todos",
            "description": "To-dos with their space, part of the course, deadline, steps and whether they are on Today. Open ones by default, the soonest deadline first.",
            "inputSchema": {"type": "object", "properties": {
                "space": s("Only this space (name)"),
                "status": {"type": "string", "enum": ["open", "done", "all"], "description": "Defaults to open"},
                "due_before": s("Only with a deadline on or before this day, like 2026-11-30"),
            }},
            "annotations": read("Read to-dos"),
        }),
        json!({
            "name": "search",
            "description": "Finds events of any date and to-dos (also done ones) by words in their title, notes, room or steps.",
            "inputSchema": {"type": "object", "properties": {"query": s("Words to look for")}, "required": ["query"]},
            "annotations": read("Search Milo"),
        }),
        json!({
            "name": "get_time_per_space",
            "description": "Minutes spent per space between two days (both included), split in class, self-study, other and sleep, as Milo's Insights counts them.",
            "inputSchema": {"type": "object", "properties": {"from": s("First day"), "to": s("Last day, included")}, "required": ["from", "to"]},
            "annotations": read("Time per space"),
        }),
        json!({
            "name": "add_event",
            "description": "Puts an event in the calendar, for example a study block. Give an end or minutes (default 60), or all_day.",
            "inputSchema": {"type": "object", "properties": {
                "title": s("What it is"),
                "space": s("Name of the space it belongs to (see get_overview)"),
                "start": s("Local start, like 2026-11-17T14:00, or a day for all_day"),
                "end": s("Local end, or the last day for all_day"),
                "minutes": {"type": "integer", "description": "Length when no end is given"},
                "all_day": {"type": "boolean"},
                "activity": s("Activity name (see get_overview), like Self-study"),
                "location": s("Room or place"),
                "notes": s("Notes"),
            }, "required": ["title", "space", "start"]},
            "annotations": write("Add an event"),
        }),
        json!({
            "name": "change_event",
            "description": "Changes an event: move it, rename it, mark that it did not happen. Only the fields given change; a new start without an end keeps the length.",
            "inputSchema": {"type": "object", "properties": {
                "id": s("Event id from get_calendar"),
                "title": s("New title"),
                "start": s("New local start"),
                "end": s("New local end"),
                "minutes": {"type": "integer", "description": "New length"},
                "space": s("New space (name)"),
                "activity": s("New activity (name), or empty for none"),
                "location": s("New room or place"),
                "notes": s("New notes"),
                "happened": {"type": "boolean", "description": "false when it did not happen"},
            }, "required": ["id"]},
            "annotations": write("Change an event"),
        }),
        json!({
            "name": "add_todo",
            "description": "Adds a to-do. Without a space it goes to the Inbox. In a course it can go under a part (made if new).",
            "inputSchema": {"type": "object", "properties": {
                "title": s("The to-do"),
                "space": s("Space name; leave out for the Inbox"),
                "part": s("Part of the course, like 02 Titration"),
                "deadline": s("Day (2026-11-20) or time (2026-11-20T09:00)"),
                "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                "notes": s("Notes"),
                "steps": {"type": "array", "items": {"type": "string"}, "description": "Steps, in order"},
                "today": {"type": "boolean", "description": "Put it on Today"},
            }, "required": ["title"]},
            "annotations": write("Add a to-do"),
        }),
        json!({
            "name": "change_todo",
            "description": "Changes a to-do: tick it off, rename it, move it, change or clear the deadline (empty string clears). Only the fields given change. Done with steps ticks all steps.",
            "inputSchema": {"type": "object", "properties": {
                "id": s("To-do id from get_todos or search"),
                "title": s("New title"),
                "space": s("New space (name)"),
                "deadline": s("New deadline, or empty to clear"),
                "priority": s("low, medium, high, or empty to clear"),
                "notes": s("New notes"),
                "done": {"type": "boolean"},
                "today": {"type": "boolean", "description": "On Today or not"},
            }, "required": ["id"]},
            "annotations": write("Change a to-do"),
        }),
        json!({
            "name": "archive",
            "description": "Moves an event or to-do to Milo's archive (not deleted: it can be restored in Settings › Archive).",
            "inputSchema": {"type": "object", "properties": {
                "kind": {"type": "string", "enum": ["event", "todo"]},
                "id": s("Its id"),
            }, "required": ["kind", "id"]},
            "annotations": write("Archive"),
        }),
    ]
}

// ---------- arguments ----------

fn text<'a>(a: &'a Value, key: &str) -> Option<&'a str> {
    a.get(key).and_then(Value::as_str).map(str::trim)
}

fn given<'a>(a: &'a Value, key: &str) -> Option<&'a str> {
    text(a, key).filter(|s| !s.is_empty())
}

fn need<'a>(a: &'a Value, key: &str) -> Result<&'a str> {
    given(a, key).ok_or_else(|| invalid(format!("{key} is needed")))
}

fn flag(a: &Value, key: &str) -> Option<bool> {
    a.get(key).and_then(Value::as_bool)
}

/// A local time ("2026-11-17T14:00", with or without seconds) or day ("2026-11-17"); an offset
/// or Z is respected. Returns the moment and whether only a day was given.
fn moment(s: &str) -> Result<(DateTime<Utc>, bool)> {
    let s = s.trim();
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return Ok((t.with_timezone(&Utc), false));
    }
    for f in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(s, f) {
            return Ok((local(n), false));
        }
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Ok((local(d.and_hms_opt(0, 0, 0).unwrap()), true));
    }
    Err(invalid(format!("Not a day or time: \"{s}\". Use 2026-11-17 or 2026-11-17T14:00.")))
}

fn day(s: &str) -> Result<NaiveDate> {
    let (t, _) = moment(s)?;
    Ok(t.with_timezone(&Local).date_naive())
}

fn local(n: NaiveDateTime) -> DateTime<Utc> {
    // A time skipped by daylight saving moves on an hour; a doubled one takes the first.
    Local
        .from_local_datetime(&n)
        .earliest()
        .or_else(|| Local.from_local_datetime(&(n + Duration::hours(1))).earliest())
        .map(|t| t.with_timezone(&Utc))
        .unwrap_or_else(|| Utc.from_utc_datetime(&n))
}

fn midnight(d: NaiveDate) -> DateTime<Utc> {
    local(d.and_hms_opt(0, 0, 0).unwrap())
}

/// Stored form: UTC with milliseconds, as everywhere in Milo (compared as text).
fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn parse_stored(s: &str) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(s).ok().map(|t| t.with_timezone(&Local))
}

fn show(s: &str) -> String {
    parse_stored(s).map(|t| t.format("%Y-%m-%dT%H:%M").to_string()).unwrap_or_else(|| s.to_string())
}

/// A deadline: just the day when it is the end of a day (how Milo stores date-only deadlines).
fn show_deadline(s: &str) -> String {
    match parse_stored(s) {
        Some(t) if t.hour() == 23 && t.minute() == 59 => t.format("%Y-%m-%d").to_string(),
        Some(t) => t.format("%Y-%m-%dT%H:%M").to_string(),
        None => s.to_string(),
    }
}

fn deadline_from(s: &str) -> Result<String> {
    let (t, only_day) = moment(s)?;
    Ok(if only_day {
        iso(local(t.with_timezone(&Local).date_naive().and_hms_opt(23, 59, 0).unwrap()))
    } else {
        iso(t)
    })
}

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

// ---------- names ----------

/// Spaces, groups, parts and activities, to turn names into ids and back.
struct Names {
    spaces: Vec<Space>,
    groups: HashMap<String, String>,
    sections: Vec<Section>,
    activities: Vec<Activity>,
}

impl Names {
    fn load(c: &Connection) -> Result<Self> {
        Ok(Names {
            spaces: repo::list_spaces(c)?.into_iter().filter(|s| s.deleted_at.is_none()).collect(),
            groups: repo::list_groups(c)?.into_iter().filter(|g| g.deleted_at.is_none()).map(|g| (g.id, g.name)).collect(),
            sections: repo::list_sections(c)?,
            activities: repo::list_activities(c)?.into_iter().filter(|a| a.deleted_at.is_none()).collect(),
        })
    }

    fn space(&self, id: &str) -> String {
        self.spaces.iter().find(|s| s.id == id).map(|s| s.name.clone()).unwrap_or_else(|| "(archived space)".into())
    }

    fn section(&self, id: &Option<String>) -> Option<String> {
        id.as_ref().and_then(|id| self.sections.iter().find(|s| &s.id == id)).map(|s| s.name.clone())
    }

    fn activity(&self, id: &Option<String>) -> Option<String> {
        id.as_ref().and_then(|id| self.activities.iter().find(|a| &a.id == id)).map(|a| a.name.clone())
    }

    /// By id, by name (any case), or by a part of the name that fits one space only.
    fn find_space(&self, wanted: &str) -> Result<&Space> {
        let w = wanted.trim().to_lowercase();
        if let Some(s) = self.spaces.iter().find(|s| s.id == wanted || s.name.to_lowercase() == w) {
            return Ok(s);
        }
        let close: Vec<&Space> = self.spaces.iter().filter(|s| s.name.to_lowercase().contains(&w)).collect();
        match close.as_slice() {
            [one] => Ok(one),
            _ => Err(invalid(format!(
                "No space called \"{wanted}\". Spaces: {}",
                self.spaces.iter().map(|s| s.name.as_str()).collect::<Vec<_>>().join(", ")
            ))),
        }
    }

    fn find_activity(&self, wanted: &str) -> Result<&Activity> {
        let w = wanted.trim().to_lowercase();
        self.activities.iter().find(|a| a.id == wanted || a.name.to_lowercase() == w).ok_or_else(|| {
            invalid(format!(
                "No activity called \"{wanted}\". Activities: {}",
                self.activities.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")
            ))
        })
    }
}

fn kind_name(kind: &str) -> &str {
    match kind {
        "project" => "course",
        "list" => "list",
        "inbox" => "inbox",
        _ => "time only",
    }
}

fn event_json(e: &Event, n: &Names) -> Value {
    let (start, end) = if e.all_day {
        let s = parse_stored(&e.start_at).map(|t| t.format("%Y-%m-%d").to_string()).unwrap_or_default();
        // Stored as the midnight after the last day.
        let last = parse_stored(&e.end_at).map(|t| (t - Duration::minutes(1)).format("%Y-%m-%d").to_string()).unwrap_or_default();
        (s, last)
    } else {
        (show(&e.start_at), show(&e.end_at))
    };
    let mut v = json!({
        "id": e.id,
        "title": e.title,
        "day": parse_stored(&e.start_at).map(|t| t.format("%A %-d %B").to_string()),
        "start": start,
        "end": end,
        "space": n.space(&e.space_id),
    });
    let o = v.as_object_mut().unwrap();
    if e.all_day {
        o.insert("all_day".into(), json!(true));
    }
    if let Some(a) = n.activity(&e.activity_id) {
        o.insert("activity".into(), json!(a));
    }
    if !e.location.is_empty() {
        o.insert("location".into(), json!(e.location));
    }
    if !e.notes.is_empty() {
        o.insert("notes".into(), json!(e.notes));
    }
    if e.status == "skipped" {
        o.insert("happened".into(), json!(false));
    }
    if e.series_id.is_some() {
        o.insert("repeats".into(), json!(true));
    }
    if e.source == "import" {
        o.insert("from_imported_calendar".into(), json!(true));
    }
    v
}

fn todo_json(t: &Task, n: &Names) -> Value {
    let mut v = json!({"id": t.id, "title": t.title, "space": n.space(&t.space_id), "done": t.completed_at.is_some()});
    let o = v.as_object_mut().unwrap();
    if let Some(p) = n.section(&t.section_id) {
        o.insert("part".into(), json!(p));
    }
    if let Some(d) = &t.deadline_at {
        o.insert("deadline".into(), json!(show_deadline(d)));
    }
    if let Some(p) = &t.priority {
        o.insert("priority".into(), json!(p));
    }
    if t.today_on.as_deref() == Some(today().as_str()) {
        o.insert("on_today".into(), json!(true));
    }
    if !t.notes.is_empty() {
        o.insert("notes".into(), json!(t.notes));
    }
    if !t.parts.is_empty() {
        o.insert("steps".into(), json!(t.parts.iter().map(|p| json!({"title": p.title, "done": p.done_at.is_some()})).collect::<Vec<_>>()));
    }
    if let Some(d) = &t.completed_at {
        o.insert("done_at".into(), json!(show(d)));
    }
    v
}

// ---------- reading ----------

fn read(c: &Connection, name: &str, a: &Value) -> Result<Value> {
    let n = Names::load(c)?;
    match name {
        "get_overview" => {
            let now = Local::now();
            let sections = |id: &str| n.sections.iter().filter(|s| s.space_id == id).map(|s| s.name.clone()).collect::<Vec<_>>();
            Ok(json!({
                "now": now.format("%Y-%m-%dT%H:%M").to_string(),
                "today": now.format("%A %-d %B %Y").to_string(),
                "utc_offset": now.format("%:z").to_string(),
                "spaces": n.spaces.iter().map(|s| {
                    let mut v = json!({"name": s.name, "kind": kind_name(&s.kind)});
                    if let Some(g) = s.group_id.as_ref().and_then(|g| n.groups.get(g)) {
                        v["group"] = json!(g);
                    }
                    if s.kind == "project" {
                        v["parts"] = json!(sections(&s.id));
                    }
                    if s.role == "sleep" {
                        v["for_sleep"] = json!(true);
                    }
                    v
                }).collect::<Vec<_>>(),
                "activities": n.activities.iter().map(|a| a.name.clone()).collect::<Vec<_>>(),
            }))
        }
        "get_calendar" => {
            let from = day(need(a, "from")?)?;
            let to = given(a, "to").map(day).transpose()?.unwrap_or(from);
            if to < from {
                return Err(invalid("to is before from"));
            }
            if (to - from).num_days() > 366 {
                return Err(invalid("Ask for at most a year at a time"));
            }
            let space = given(a, "space").map(|s| n.find_space(s)).transpose()?;
            let events: Vec<Value> = repo::list_events(c, &iso(midnight(from)), &iso(midnight(to + Duration::days(1))))?
                .iter()
                .filter(|e| space.is_none_or(|s| s.id == e.space_id))
                .map(|e| event_json(e, &n))
                .collect();
            Ok(json!({"from": from.to_string(), "to": to.to_string(), "count": events.len(), "events": events}))
        }
        "get_todos" => {
            let space = given(a, "space").map(|s| n.find_space(s)).transpose()?;
            let status = given(a, "status").unwrap_or("open");
            let before = given(a, "due_before").map(|d| deadline_from(&day(d)?.to_string())).transpose()?;
            let mut todos: Vec<Task> = repo::list_tasks(c)?
                .into_iter()
                .filter(|t| space.is_none_or(|s| s.id == t.space_id))
                .filter(|t| match status {
                    "done" => t.completed_at.is_some(),
                    "all" => true,
                    _ => t.completed_at.is_none(),
                })
                .filter(|t| before.as_ref().is_none_or(|b| t.deadline_at.as_ref().is_some_and(|d| d <= b)))
                .collect();
            todos.sort_by(|x, y| match (&x.deadline_at, &y.deadline_at) {
                (Some(a), Some(b)) => a.cmp(b),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => x.created_at.cmp(&y.created_at),
            });
            let total = todos.len();
            let list: Vec<Value> = todos.iter().take(300).map(|t| todo_json(t, &n)).collect();
            Ok(json!({"count": total, "shown": list.len(), "todos": list}))
        }
        "search" => {
            let r = search::search(c, need(a, "query")?, &iso(Utc::now()))?;
            let when = |w: &Option<search::When>| w.as_ref().map(|w| if w.all_day { show_deadline(&w.start_at)[..10].to_string() } else { show(&w.start_at) });
            Ok(json!({
                "events": r.events.iter().map(|e| json!({
                    "title": e.title, "space": n.space(&e.space_id), "location": e.location,
                    "times": e.count, "last": when(&e.last), "next": when(&e.next),
                    "next_id": e.next.as_ref().or(e.last.as_ref()).map(|w| w.event_id.clone()),
                })).collect::<Vec<_>>(),
                "todos": r.tasks.iter().map(|t| json!({
                    "id": t.id, "title": t.title, "space": n.space(&t.space_id),
                    "deadline": t.deadline_at.as_deref().map(show_deadline), "done": t.completed_at.is_some(),
                })).collect::<Vec<_>>(),
            }))
        }
        "get_time_per_space" => {
            let (from, to) = (day(need(a, "from")?)?, day(need(a, "to")?)?);
            let data = insights::insights_for(c, &from.to_string(), &(to + Duration::days(1)).to_string())?;
            let hours = |m: i64| (m as f64 / 6.0).round() / 10.0;
            let spaces: Vec<Value> = data
                .spaces
                .iter()
                .map(|s| {
                    let total = s.class + s.self_study + s.other + s.sleep;
                    json!({"space": n.space(&s.space_id), "class_minutes": s.class, "self_study_minutes": s.self_study,
                           "other_minutes": s.other, "sleep_minutes": s.sleep, "total_hours": hours(total)})
                })
                .collect();
            let t = &data.totals;
            Ok(json!({"from": from.to_string(), "to": to.to_string(), "spaces": spaces,
                      "productive_hours": hours(t.class + t.self_study), "sleep_hours": hours(t.sleep)}))
        }
        _ => Err(invalid(format!("Milo has no tool called {name}"))),
    }
}

// ---------- writing ----------

fn write(c: &Connection, name: &str, a: &Value) -> Result<Value> {
    let n = Names::load(c)?;
    match name {
        "add_event" => {
            let space = n.find_space(need(a, "space")?)?;
            let activity_id = given(a, "activity").map(|x| n.find_activity(x).map(|a| a.id.clone())).transpose()?;
            let (start, end, all_day) = span(a, None)?;
            let e = repo::create_event(
                c,
                EventInput {
                    space_id: space.id.clone(),
                    activity_id,
                    title: need(a, "title")?.to_string(),
                    start_at: iso(start),
                    end_at: iso(end),
                    all_day,
                    notes: text(a, "notes").unwrap_or("").to_string(),
                    status: "planned".into(),
                    task_id: None,
                    location: text(a, "location").unwrap_or("").to_string(),
                    reminders: None,
                },
                "manual",
            )?;
            Ok(json!({"added": event_json(&e, &n)}))
        }
        "change_event" => {
            let e = repo::find_event(c, need(a, "id")?)?.ok_or_else(|| invalid("No event with that id (it may be archived)"))?;
            let mut input = EventInput {
                space_id: e.space_id.clone(),
                activity_id: e.activity_id.clone(),
                title: e.title.clone(),
                start_at: e.start_at.clone(),
                end_at: e.end_at.clone(),
                all_day: e.all_day,
                notes: e.notes.clone(),
                status: e.status.clone(),
                task_id: e.task_id.clone(),
                location: e.location.clone(),
                reminders: e.reminders.clone(),
            };
            if let Some(t) = given(a, "title") {
                input.title = t.into();
            }
            if let Some(s) = given(a, "space") {
                input.space_id = n.find_space(s)?.id.clone();
            }
            if let Some(x) = text(a, "activity") {
                input.activity_id = if x.is_empty() { None } else { Some(n.find_activity(x)?.id.clone()) };
            }
            if let Some(x) = text(a, "location") {
                input.location = x.into();
            }
            if let Some(x) = a.get("notes").and_then(Value::as_str) {
                input.notes = x.into();
            }
            if let Some(h) = flag(a, "happened") {
                input.status = if h { "planned" } else { "skipped" }.into();
            }
            if given(a, "start").is_some() || given(a, "end").is_some() || a.get("minutes").is_some() || flag(a, "all_day").is_some() {
                let (s, en, all_day) = span(a, Some(&e))?;
                (input.start_at, input.end_at, input.all_day) = (iso(s), iso(en), all_day);
            }
            let changed = repo::update_event(c, &e.id, input)?;
            Ok(json!({"changed": event_json(&changed, &n), "before": event_json(&e, &n)}))
        }
        "add_todo" => {
            let space = match given(a, "space") {
                Some(s) => n.find_space(s)?,
                None => n.spaces.iter().find(|s| s.id == repo::INBOX).ok_or_else(|| invalid("There is no Inbox"))?,
            };
            let section_id = match given(a, "part") {
                Some(p) if space.kind == "project" => Some(section(c, &n, &space.id, p)?),
                Some(_) => return Err(invalid(format!("{} is not a course, so it has no parts", space.name))),
                None => None,
            };
            let t = repo::create_task(
                c,
                TaskInput {
                    space_id: space.id.clone(),
                    type_id: None,
                    title: need(a, "title")?.to_string(),
                    notes: text(a, "notes").unwrap_or("").to_string(),
                    deadline_at: given(a, "deadline").map(deadline_from).transpose()?,
                    target_at: None,
                    priority: given(a, "priority").map(String::from),
                    section_id,
                },
            )?;
            for step in a.get("steps").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
                if !step.trim().is_empty() {
                    repo::create_task_part(c, &t.id, TaskPartInput { title: step.trim().into(), weight: 1.0 })?;
                }
            }
            if flag(a, "today") == Some(true) {
                repo::set_task_today(c, &t.id, Some(&today()))?;
            }
            let n = Names::load(c)?;
            Ok(json!({"added": todo_json(&repo::get_task(c, &t.id)?, &n)}))
        }
        "change_todo" => {
            let id = need(a, "id")?;
            let t = repo::list_tasks(c)?.into_iter().find(|t| t.id == id).ok_or_else(|| invalid("No to-do with that id (it may be archived)"))?;
            let mut input = TaskInput {
                space_id: t.space_id.clone(),
                type_id: t.type_id.clone(),
                title: t.title.clone(),
                notes: t.notes.clone(),
                deadline_at: t.deadline_at.clone(),
                target_at: t.target_at.clone(),
                priority: t.priority.clone(),
                section_id: t.section_id.clone(),
            };
            if let Some(x) = given(a, "title") {
                input.title = x.into();
            }
            if let Some(s) = given(a, "space") {
                input.space_id = n.find_space(s)?.id.clone();
            }
            if let Some(d) = text(a, "deadline") {
                input.deadline_at = if d.is_empty() { None } else { Some(deadline_from(d)?) };
            }
            if let Some(p) = text(a, "priority") {
                input.priority = if p.is_empty() { None } else { Some(p.to_lowercase()) };
            }
            if let Some(x) = a.get("notes").and_then(Value::as_str) {
                input.notes = x.into();
            }
            repo::update_task(c, &t.id, input)?;
            if let Some(done) = flag(a, "done") {
                if t.parts.is_empty() {
                    repo::set_task_completed(c, &t.id, done)?;
                } else {
                    for p in &t.parts {
                        if p.done_at.is_some() != done {
                            repo::set_part_done(c, &p.id, done)?;
                        }
                    }
                }
            }
            if let Some(on) = flag(a, "today") {
                repo::set_task_today(c, &t.id, if on { Some(today()) } else { None }.as_deref())?;
            }
            let n = Names::load(c)?;
            Ok(json!({"changed": todo_json(&repo::get_task(c, &t.id)?, &n), "before": todo_json(&t, &n)}))
        }
        "archive" => {
            let id = need(a, "id")?;
            let (entity, label) = match need(a, "kind")? {
                "event" => ("event", repo::find_event(c, id)?.ok_or_else(|| invalid("No event with that id"))?.title),
                "todo" => ("task", repo::list_tasks(c)?.into_iter().find(|t| t.id == id).ok_or_else(|| invalid("No to-do with that id"))?.title),
                other => return Err(invalid(format!("Cannot archive a {other}; use event or todo"))),
            };
            repo::set_archived(c, entity, id, true)?;
            Ok(json!({"archived": label, "note": "It can be brought back in Milo › Settings › Archive."}))
        }
        _ => Err(invalid(format!("Milo has no tool called {name}"))),
    }
}

/// Start, end and all-day from the arguments; for a change, what is not given comes from `old`.
fn span(a: &Value, old: Option<&Event>) -> Result<(DateTime<Utc>, DateTime<Utc>, bool)> {
    let stored = |s: &str| DateTime::parse_from_rfc3339(s).map(|t| t.with_timezone(&Utc)).ok();
    let all_day = flag(a, "all_day").or(old.map(|e| e.all_day)).unwrap_or(false);
    let start = match given(a, "start") {
        Some(s) => moment(s)?.0,
        None => old.and_then(|e| stored(&e.start_at)).ok_or_else(|| invalid("start is needed"))?,
    };
    if all_day {
        let first = start.with_timezone(&Local).date_naive();
        let last = match given(a, "end") {
            Some(e) => day(e)?,
            None => match old.filter(|_| given(a, "start").is_none()) {
                Some(e) => stored(&e.end_at).map(|t| (t.with_timezone(&Local) - Duration::minutes(1)).date_naive()).unwrap_or(first),
                None => first,
            },
        };
        if last < first {
            return Err(invalid("The last day is before the first"));
        }
        return Ok((midnight(first), midnight(last + Duration::days(1)), true));
    }
    let end = if let Some(e) = given(a, "end") {
        moment(e)?.0
    } else if let Some(m) = a.get("minutes").and_then(Value::as_i64) {
        start + Duration::minutes(m)
    } else if let Some(e) = old.filter(|e| !e.all_day) {
        // Moved: keep the length.
        start + (stored(&e.end_at).unwrap_or(start) - stored(&e.start_at).unwrap_or(start))
    } else {
        start + Duration::minutes(60)
    };
    if end <= start {
        return Err(invalid("An event must end after it starts"));
    }
    if end - start > Duration::days(14) {
        return Err(invalid("That is longer than two weeks; use all_day for long periods"));
    }
    Ok((start, end, false))
}

/// The part of a course with this name (any case), made when there is none yet.
fn section(c: &Connection, n: &Names, space_id: &str, name: &str) -> Result<String> {
    let w = name.trim().to_lowercase();
    if let Some(s) = n.sections.iter().find(|s| s.space_id == space_id && s.name.to_lowercase() == w) {
        return Ok(s.id.clone());
    }
    Ok(repo::create_section(c, space_id, name.trim())?.id)
}

// ---------- connecting an AI app ----------

/// Claude Desktop's settings file, where it lists the MCP servers it starts.
pub fn claude_config_path() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    #[cfg(target_os = "macos")]
    let dirs: Vec<PathBuf> = std::env::var_os("HOME").map(|h| vec![PathBuf::from(h).join("Library/Application Support/Claude")]).unwrap_or_default();
    #[cfg(windows)]
    let dirs: Vec<PathBuf> = {
        let mut d = Vec::new();
        // The Microsoft Store version keeps its files inside its package folder.
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            if let Ok(it) = std::fs::read_dir(PathBuf::from(local).join("Packages")) {
                for e in it.flatten() {
                    if e.file_name().to_string_lossy().starts_with("Claude_") {
                        d.push(e.path().join("LocalCache/Roaming/Claude"));
                    }
                }
            }
        }
        if let Some(a) = std::env::var_os("APPDATA") {
            d.push(PathBuf::from(a).join("Claude"));
        }
        d
    };
    #[cfg(not(any(target_os = "macos", windows)))]
    let dirs: Vec<PathBuf> = std::env::var_os("HOME").map(|h| vec![PathBuf::from(h).join(".config/Claude")]).unwrap_or_default();
    dirs.into_iter().find(|d| d.is_dir()).map(|d| d.join("claude_desktop_config.json"))
}

/// What an AI app needs to start Milo: this program with `--mcp`.
pub fn server_entry() -> Result<Value> {
    let exe = std::env::current_exe()?;
    Ok(json!({"command": exe.to_string_lossy(), "args": ["--mcp"]}))
}

/// Whether Claude Desktop's settings already start this Milo.
pub fn claude_connected(path: &std::path::Path) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else { return false };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return false };
    server_entry().is_ok_and(|e| v["mcpServers"]["milo"]["command"] == e["command"])
}

/// Adds Milo to Claude Desktop's settings, keeping everything else in the file. A file that
/// cannot be read as JSON is left alone. The first time, the old file is kept beside it.
pub fn connect_claude(path: &std::path::Path) -> Result<()> {
    let mut v = match std::fs::read_to_string(path) {
        Ok(text) if !text.trim().is_empty() => serde_json::from_str::<Value>(&text)
            .map_err(|_| invalid("Claude's settings file could not be read, so Milo left it alone. Copy the settings instead."))?,
        _ => json!({}),
    };
    if !v.is_object() {
        return Err(invalid("Claude's settings file has an unexpected shape, so Milo left it alone. Copy the settings instead."));
    }
    if path.exists() {
        let keep = path.with_extension("json.before-milo");
        if !keep.exists() {
            std::fs::copy(path, keep)?;
        }
    }
    if !v["mcpServers"].is_object() {
        v["mcpServers"] = json!({});
    }
    v["mcpServers"]["milo"] = server_entry()?;
    std::fs::write(path, serde_json::to_string_pretty(&v).unwrap_or_default() + "\n")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn ask(c: &Connection, method: &str, params: Value) -> Value {
        handle(c, &json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})).unwrap()
    }

    fn tool(c: &Connection, name: &str, args: Value) -> (bool, Value) {
        let r = ask(c, "tools/call", json!({"name": name, "arguments": args}));
        let text = r["result"]["content"][0]["text"].as_str().unwrap().to_string();
        let err = r["result"]["isError"].as_bool().unwrap();
        (err, serde_json::from_str(&text).unwrap_or(Value::String(text)))
    }

    #[test]
    fn speaks_the_protocol() {
        let c = open_in_memory().unwrap();
        let init = ask(&c, "initialize", json!({"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}));
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["result"]["serverInfo"]["name"], "milo");
        assert!(handle(&c, &json!({"jsonrpc": "2.0", "method": "notifications/initialized"})).is_none());
        let list = ask(&c, "tools/list", json!({}));
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 10);
        assert_eq!(ask(&c, "nope", json!({}))["error"]["code"], -32601);
    }

    #[test]
    fn does_only_what_she_allows() {
        let c = open_in_memory().unwrap();
        let (err, msg) = tool(&c, "get_overview", json!({}));
        assert!(err && msg.as_str().unwrap().contains("Settings › Connect AI"));

        repo::set_setting(&c, ACCESS_SETTING, Some("read")).unwrap();
        assert!(!tool(&c, "get_overview", json!({})).0);
        let (err, msg) = tool(&c, "add_todo", json!({"title": "x"}));
        assert!(err && msg.as_str().unwrap().contains("reading only"));
        assert!(repo::list_tasks(&c).unwrap().is_empty());
    }

    #[test]
    fn adds_reads_changes_and_archives() {
        let c = open_in_memory().unwrap();
        repo::set_setting(&c, ACCESS_SETTING, Some("write")).unwrap();

        let (err, v) = tool(&c, "add_event", json!({"title": "Study chemistry", "space": "personal", "start": "2026-11-17T14:00", "minutes": 90, "activity": "Study", "location": "Library"}));
        assert!(!err, "{v}");
        let id = v["added"]["id"].as_str().unwrap().to_string();
        assert_eq!(v["added"]["start"], "2026-11-17T14:00");
        assert_eq!(v["added"]["end"], "2026-11-17T15:30");
        assert_eq!(v["added"]["day"], "Tuesday 17 November");

        let (_, cal) = tool(&c, "get_calendar", json!({"from": "2026-11-17"}));
        assert_eq!(cal["count"], 1);
        assert_eq!(cal["events"][0]["location"], "Library");
        assert_eq!(tool(&c, "get_calendar", json!({"from": "2026-11-18"})).1["count"], 0);

        // Moved: the length stays.
        let (_, moved) = tool(&c, "change_event", json!({"id": id, "start": "2026-11-18T09:00", "happened": false}));
        assert_eq!(moved["changed"]["end"], "2026-11-18T10:30");
        assert_eq!(moved["changed"]["happened"], false);
        assert_eq!(moved["before"]["start"], "2026-11-17T14:00");

        let (err, all_day) = tool(&c, "add_event", json!({"title": "Exams", "space": "Personal", "start": "2026-01-12", "end": "2026-01-16", "all_day": true}));
        assert!(!err, "{all_day}");
        assert_eq!((all_day["added"]["start"].as_str(), all_day["added"]["end"].as_str()), (Some("2026-01-12"), Some("2026-01-16")));

        let (err, msg) = tool(&c, "add_event", json!({"title": "x", "space": "Nowhere", "start": "2026-11-17T10:00"}));
        assert!(err && msg.as_str().unwrap().contains("Spaces: "));

        let (err, t) = tool(&c, "add_todo", json!({"title": "Lab report", "deadline": "2026-11-20", "steps": ["Data", "Discussion"], "today": true}));
        assert!(!err, "{t}");
        assert_eq!(t["added"]["space"], "Inbox");
        assert_eq!(t["added"]["deadline"], "2026-11-20");
        assert_eq!(t["added"]["on_today"], true);
        let tid = t["added"]["id"].as_str().unwrap().to_string();

        let (_, open) = tool(&c, "get_todos", json!({"due_before": "2026-11-30"}));
        assert_eq!(open["count"], 1);
        let (_, done) = tool(&c, "change_todo", json!({"id": tid, "done": true, "deadline": ""}));
        assert_eq!(done["changed"]["done"], true, "{done}");
        assert!(done["changed"]["steps"].as_array().unwrap().iter().all(|s| s["done"] == true));
        assert!(done["changed"].get("deadline").is_none());
        assert_eq!(tool(&c, "get_todos", json!({})).1["count"], 0);
        assert_eq!(tool(&c, "get_todos", json!({"status": "done"})).1["count"], 1);

        let (err, _) = tool(&c, "archive", json!({"kind": "event", "id": id}));
        assert!(!err);
        assert!(repo::find_event(&c, &id).unwrap().is_none());
        assert_eq!(tool(&c, "change_event", json!({"id": id, "title": "y"})).0, true);
    }

    #[test]
    fn a_failed_change_leaves_nothing_behind() {
        let c = open_in_memory().unwrap();
        repo::set_setting(&c, ACCESS_SETTING, Some("write")).unwrap();
        // The new part is made first, then the bad priority fails: the part goes too.
        c.execute("UPDATE spaces SET kind = 'project' WHERE id = 'seed-space-personal'", []).unwrap();
        let (err, _) = tool(&c, "add_todo", json!({"title": "Half", "space": "Personal", "part": "New part", "priority": "urgent"}));
        assert!(err);
        assert!(repo::list_tasks(&c).unwrap().is_empty());
        assert!(repo::list_sections(&c).unwrap().iter().all(|s| s.name != "New part"));
    }

    #[test]
    fn joins_claude_settings_without_losing_anything() {
        let dir = std::env::temp_dir().join(format!("milo-mcp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("claude_desktop_config.json");
        std::fs::write(&path, r#"{"mcpServers": {"other": {"command": "x"}}, "theme": "dark"}"#).unwrap();
        assert!(!claude_connected(&path));
        connect_claude(&path).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["mcpServers"]["other"]["command"], "x");
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["mcpServers"]["milo"]["args"][0], "--mcp");
        assert!(claude_connected(&path));
        assert!(dir.join("claude_desktop_config.json.before-milo").exists());

        std::fs::write(&path, "{ not json").unwrap();
        assert!(connect_claude(&path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ not json", "left alone");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_days_and_times() {
        assert!(moment("2026-11-17").unwrap().1);
        assert!(!moment("2026-11-17T14:00").unwrap().1);
        assert_eq!(moment("2026-11-17T14:00:00Z").unwrap().0.hour(), 14);
        assert!(moment("next tuesday").is_err());
        let d = deadline_from("2026-11-20").unwrap();
        assert_eq!(show_deadline(&d), "2026-11-20");
    }
}
