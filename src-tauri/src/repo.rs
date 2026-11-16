//! All reads and writes. Plain functions over a `Connection` so they can be tested
//! without Tauri, and so a later proposals layer can call the same functions.

use crate::db::{new_id, now};
use crate::error::{AppError, Result};
use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension, Row};

fn non_empty(value: &str, field: &str) -> Result<String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(AppError::Invalid(format!("{field} cannot be empty")));
    }
    Ok(v.to_string())
}

fn one_of(value: &str, allowed: &[&str], field: &str) -> Result<()> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("Unknown {field}: {value}")))
    }
}

fn next_sort(c: &Connection, table: &'static str) -> Result<i64> {
    Ok(c.query_row(
        &format!("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM {table}"),
        [],
        |r| r.get(0),
    )?)
}

fn changed(n: usize) -> Result<()> {
    if n == 0 {
        Err(AppError::NotFound)
    } else {
        Ok(())
    }
}

// ---------- groups ----------

fn group_from(r: &Row) -> rusqlite::Result<Group> {
    Ok(Group {
        id: r.get("id")?,
        name: r.get("name")?,
        sort_order: r.get("sort_order")?,
        deleted_at: r.get("deleted_at")?,
    })
}

pub fn list_groups(c: &Connection) -> Result<Vec<Group>> {
    let mut s = c.prepare("SELECT * FROM groups ORDER BY sort_order, name")?;
    let rows = s.query_map([], group_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn get_group(c: &Connection, id: &str) -> Result<Group> {
    Ok(c.query_row("SELECT * FROM groups WHERE id = ?1", [id], group_from)?)
}

pub fn create_group(c: &Connection, input: GroupInput) -> Result<Group> {
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO groups (id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, non_empty(&input.name, "Name")?, next_sort(c, "groups")?, ts],
    )?;
    get_group(c, &id)
}

pub fn update_group(c: &Connection, id: &str, input: GroupInput) -> Result<Group> {
    changed(c.execute(
        "UPDATE groups SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, non_empty(&input.name, "Name")?, now()],
    )?)?;
    get_group(c, id)
}

// ---------- spaces ----------

fn space_from(r: &Row) -> rusqlite::Result<Space> {
    Ok(Space {
        id: r.get("id")?,
        group_id: r.get("group_id")?,
        name: r.get("name")?,
        color: r.get("color")?,
        role: r.get("role")?,
        kind: r.get("kind")?,
        icon: r.get("icon")?,
        sort_order: r.get("sort_order")?,
        deleted_at: r.get("deleted_at")?,
    })
}

pub fn list_spaces(c: &Connection) -> Result<Vec<Space>> {
    let mut s = c.prepare("SELECT * FROM spaces ORDER BY sort_order, name")?;
    let rows = s.query_map([], space_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn get_space(c: &Connection, id: &str) -> Result<Space> {
    Ok(c.query_row("SELECT * FROM spaces WHERE id = ?1", [id], space_from)?)
}

/// The hidden space quick notes land in.
pub const INBOX: &str = "seed-space-inbox";

const KINDS: &[&str] = &["project", "list", "none"];

pub fn create_space(c: &Connection, input: SpaceInput) -> Result<Space> {
    one_of(&input.role, &["normal", "sleep"], "role")?;
    let kind = input.kind.clone().unwrap_or_else(|| "list".into());
    one_of(&kind, KINDS, "kind")?;
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO spaces (id, group_id, name, color, role, kind, icon, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            input.group_id,
            non_empty(&input.name, "Name")?,
            input.color,
            input.role,
            kind,
            icon(&input.icon)?,
            next_sort(c, "spaces")?,
            ts
        ],
    )?;
    get_space(c, &id)
}

pub fn update_space(c: &Connection, id: &str, input: SpaceInput) -> Result<Space> {
    one_of(&input.role, &["normal", "sleep"], "role")?;
    if let Some(kind) = &input.kind {
        one_of(kind, KINDS, "kind")?;
    }
    // The Inbox stays what it is; leaving the kind out keeps it.
    changed(c.execute(
        "UPDATE spaces SET group_id = ?2, name = ?3, color = ?4, role = ?5, icon = ?6, updated_at = ?7,
         kind = CASE WHEN kind = 'inbox' THEN kind ELSE COALESCE(?8, kind) END WHERE id = ?1",
        params![id, input.group_id, non_empty(&input.name, "Name")?, input.color, input.role, icon(&input.icon)?, now(), input.kind],
    )?)?;
    get_space(c, id)
}

/// An icon name is a short word from the app's own set; anything else is refused.
fn icon(value: &Option<String>) -> Result<Option<String>> {
    match value.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(v) if v.len() <= 24 && v.chars().all(|ch| ch.is_ascii_lowercase() || ch == '-') => Ok(Some(v.to_string())),
        Some(v) => Err(AppError::Invalid(format!("Unknown icon: {v}"))),
    }
}

/// Puts the named spaces in the order given (one list of the sidebar), and keeps every other
/// space where it was. All spaces share one numbering: the named ones swap places among the
/// positions they already held, and then everything is numbered 0, 1, 2… again, so a list can
/// never take the place of another (the first space is a default in a few places).
pub fn reorder_spaces(c: &Connection, ids: &[String]) -> Result<()> {
    let all: Vec<String> = c
        .prepare("SELECT id FROM spaces WHERE kind != 'inbox' ORDER BY sort_order, name")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let moved: Vec<&String> = ids.iter().filter(|id| all.contains(id)).collect();
    let slots: Vec<usize> = all.iter().enumerate().filter(|(_, id)| moved.contains(id)).map(|(i, _)| i).collect();
    let mut order = all.clone();
    for (slot, id) in slots.iter().zip(moved) {
        order[*slot] = id.clone();
    }
    let ts = now();
    for (i, id) in order.iter().enumerate() {
        c.execute(
            "UPDATE spaces SET sort_order = ?2, updated_at = ?3 WHERE id = ?1 AND sort_order != ?2",
            params![id, i as i64, ts],
        )?;
    }
    Ok(())
}

/// Drags a space into another group (or out of every group with `None`) and puts that list in
/// the given order, which includes the moved space.
pub fn move_space(c: &Connection, id: &str, group_id: Option<&str>, order: &[String]) -> Result<()> {
    if let Some(g) = group_id {
        let exists: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM groups WHERE id = ?1 AND deleted_at IS NULL)", [g], |r| r.get(0))?;
        if !exists {
            return Err(crate::error::AppError::Invalid("That group does not exist".into()));
        }
    }
    changed(c.execute("UPDATE spaces SET group_id = ?2, updated_at = ?3 WHERE id = ?1", params![id, group_id, now()])?)?;
    reorder_spaces(c, order)
}

/// Puts the groups in the order given; groups not named keep their place after them.
pub fn reorder_groups(c: &Connection, ids: &[String]) -> Result<()> {
    let all: Vec<String> = c
        .prepare("SELECT id FROM groups ORDER BY sort_order, name")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut order: Vec<&String> = ids.iter().filter(|id| all.contains(id)).collect();
    order.extend(all.iter().filter(|id| !ids.contains(id)));
    let ts = now();
    for (i, id) in order.iter().enumerate() {
        c.execute("UPDATE groups SET sort_order = ?2, updated_at = ?3 WHERE id = ?1 AND sort_order != ?2", params![id, i as i64, ts])?;
    }
    Ok(())
}

// ---------- activities ----------

// ---------- sections (the parts of a course) ----------

fn section_from(r: &Row) -> rusqlite::Result<Section> {
    Ok(Section { id: r.get("id")?, space_id: r.get("space_id")?, name: r.get("name")?, sort_order: r.get("sort_order")? })
}

pub fn list_sections(c: &Connection) -> Result<Vec<Section>> {
    let mut s = c.prepare("SELECT * FROM sections WHERE deleted_at IS NULL ORDER BY sort_order, created_at")?;
    let rows = s.query_map([], section_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn get_section(c: &Connection, id: &str) -> Result<Section> {
    Ok(c.query_row("SELECT * FROM sections WHERE id = ?1", [id], section_from)?)
}

pub fn create_section(c: &Connection, space_id: &str, name: &str) -> Result<Section> {
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO sections (id, space_id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, space_id, non_empty(name, "Name")?, next_sort(c, "sections")?, ts],
    )?;
    get_section(c, &id)
}

pub fn update_section(c: &Connection, id: &str, name: &str) -> Result<Section> {
    changed(c.execute(
        "UPDATE sections SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, non_empty(name, "Name")?, now()],
    )?)?;
    get_section(c, id)
}

/// Puts sections in the order given; ids not listed keep their place after them.
pub fn reorder_sections(c: &Connection, ids: &[String]) -> Result<()> {
    let ts = now();
    for (i, id) in ids.iter().enumerate() {
        c.execute("UPDATE sections SET sort_order = ?2, updated_at = ?3 WHERE id = ?1", params![id, i as i64, ts])?;
    }
    Ok(())
}

fn activity_from(r: &Row) -> rusqlite::Result<Activity> {
    Ok(Activity {
        id: r.get("id")?,
        name: r.get("name")?,
        category: r.get("category")?,
        sort_order: r.get("sort_order")?,
        deleted_at: r.get("deleted_at")?,
    })
}

const CATEGORIES: &[&str] = &["class", "self_study", "other"];

pub fn list_activities(c: &Connection) -> Result<Vec<Activity>> {
    let mut s = c.prepare("SELECT * FROM activities ORDER BY sort_order, name")?;
    let rows = s.query_map([], activity_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn get_activity(c: &Connection, id: &str) -> Result<Activity> {
    Ok(c.query_row("SELECT * FROM activities WHERE id = ?1", [id], activity_from)?)
}

pub fn create_activity(c: &Connection, input: ActivityInput) -> Result<Activity> {
    one_of(&input.category, CATEGORIES, "category")?;
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO activities (id, name, category, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, non_empty(&input.name, "Name")?, input.category, next_sort(c, "activities")?, ts],
    )?;
    get_activity(c, &id)
}

pub fn update_activity(c: &Connection, id: &str, input: ActivityInput) -> Result<Activity> {
    one_of(&input.category, CATEGORIES, "category")?;
    changed(c.execute(
        "UPDATE activities SET name = ?2, category = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, non_empty(&input.name, "Name")?, input.category, now()],
    )?)?;
    get_activity(c, id)
}

// ---------- events ----------

fn event_from(r: &Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: r.get("id")?,
        space_id: r.get("space_id")?,
        activity_id: r.get("activity_id")?,
        title: r.get("title")?,
        start_at: r.get("start_at")?,
        end_at: r.get("end_at")?,
        all_day: r.get("all_day")?,
        notes: r.get("notes")?,
        location: r.get("location")?,
        reminders: r.get("reminders")?,
        status: r.get("status")?,
        source: r.get("source")?,
        source_id: r.get("source_id")?,
        locally_modified: r.get("locally_modified")?,
        task_id: r.get("task_id")?,
        series_id: r.get("series_id")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        deleted_at: r.get("deleted_at")?,
    })
}

/// "10,0,10" -> "0,10": minutes before the start, each 0 to 1440, sorted, once. None stays None.
pub fn clean_reminders(r: &Option<String>) -> Result<Option<String>> {
    let Some(r) = r else { return Ok(None) };
    let mut m: Vec<i64> = Vec::new();
    for part in r.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        match part.parse::<i64>() {
            Ok(n) if (0..=1440).contains(&n) => m.push(n),
            _ => return Err(AppError::Invalid(format!("Not a reminder: {part}"))),
        }
    }
    m.sort_unstable();
    m.dedup();
    Ok(Some(m.iter().map(i64::to_string).collect::<Vec<_>>().join(",")))
}

fn check_event(input: &EventInput) -> Result<()> {
    one_of(&input.status, &["planned", "skipped"], "status")?;
    if input.end_at <= input.start_at {
        return Err(AppError::Invalid("An event must end after it starts".into()));
    }
    Ok(())
}

/// Events that overlap [from, to). Archived events are left out.
pub fn list_events(c: &Connection, from: &str, to: &str) -> Result<Vec<Event>> {
    let mut s = c.prepare(
        "SELECT * FROM events WHERE deleted_at IS NULL AND start_at < ?2 AND end_at > ?1 ORDER BY start_at",
    )?;
    let rows = s.query_map([from, to], event_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_event(c: &Connection, id: &str) -> Result<Event> {
    Ok(c.query_row("SELECT * FROM events WHERE id = ?1", [id], event_from)?)
}

/// The event with this id, unless it was archived (or never existed).
pub fn find_event(c: &Connection, id: &str) -> Result<Option<Event>> {
    Ok(c.query_row("SELECT * FROM events WHERE id = ?1 AND deleted_at IS NULL", [id], event_from).optional()?)
}

pub fn create_event(c: &Connection, input: EventInput, source: &str) -> Result<Event> {
    check_event(&input)?;
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO events (id, space_id, activity_id, title, start_at, end_at, all_day, notes, status, source, task_id, location, reminders, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?14, ?13, ?13)",
        params![
            id,
            input.space_id,
            input.activity_id,
            input.title.trim(),
            input.start_at,
            input.end_at,
            input.all_day,
            input.notes,
            input.status,
            source,
            input.task_id,
            input.location.trim(),
            ts,
            clean_reminders(&input.reminders)?
        ],
    )?;
    get_event(c, &id)
}

/// Changes an event, keeping its earlier version (see history.rs) when something differs.
pub fn update_event(c: &Connection, id: &str, input: EventInput) -> Result<Event> {
    check_event(&input)?;
    let before = get_event(c, id)?;
    let same = before.space_id == input.space_id
        && before.activity_id == input.activity_id
        && before.title == input.title.trim()
        && before.start_at == input.start_at
        && before.end_at == input.end_at
        && before.all_day == input.all_day
        && before.notes == input.notes
        && before.location == input.location.trim()
        && before.reminders == clean_reminders(&input.reminders)?
        && before.status == input.status
        && before.task_id == input.task_id;
    if same {
        return Ok(before);
    }
    if !crate::history::just_created(&before.created_at) {
        crate::history::remember(c, "event", id, &before, false)?;
    }
    update_event_unlogged(c, id, input)
}

/// Changes an event without keeping a version (history.rs keeps it itself when restoring).
pub fn update_event_unlogged(c: &Connection, id: &str, input: EventInput) -> Result<Event> {
    check_event(&input)?;
    changed(c.execute(
        "UPDATE events SET space_id = ?2, activity_id = ?3, title = ?4, start_at = ?5, end_at = ?6,
         all_day = ?7, notes = ?8, status = ?9, updated_at = ?10, task_id = ?11, location = ?12, reminders = ?13,
         locally_modified = (source = 'import') OR locally_modified WHERE id = ?1",
        params![
            id,
            input.space_id,
            input.activity_id,
            input.title.trim(),
            input.start_at,
            input.end_at,
            input.all_day,
            input.notes,
            input.status,
            now(),
            input.task_id,
            input.location.trim(),
            clean_reminders(&input.reminders)?
        ],
    )?)?;
    get_event(c, id)
}

// ---------- task types ----------

fn task_type_from(r: &Row) -> rusqlite::Result<TaskType> {
    Ok(TaskType {
        id: r.get("id")?,
        name: r.get("name")?,
        space_id: r.get("space_id")?,
        sort_order: r.get("sort_order")?,
        deleted_at: r.get("deleted_at")?,
    })
}

pub fn list_task_types(c: &Connection) -> Result<Vec<TaskType>> {
    let mut s = c.prepare("SELECT * FROM task_types ORDER BY sort_order, name")?;
    let rows = s.query_map([], task_type_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn get_task_type(c: &Connection, id: &str) -> Result<TaskType> {
    Ok(c.query_row("SELECT * FROM task_types WHERE id = ?1", [id], task_type_from)?)
}

pub fn create_task_type(c: &Connection, input: TaskTypeInput) -> Result<TaskType> {
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO task_types (id, name, space_id, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, non_empty(&input.name, "Name")?, input.space_id, next_sort(c, "task_types")?, ts],
    )?;
    get_task_type(c, &id)
}

pub fn update_task_type(c: &Connection, id: &str, input: TaskTypeInput) -> Result<TaskType> {
    changed(c.execute(
        "UPDATE task_types SET name = ?2, space_id = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, non_empty(&input.name, "Name")?, input.space_id, now()],
    )?)?;
    get_task_type(c, id)
}

// ---------- tasks and parts ----------

fn part_from(r: &Row) -> rusqlite::Result<TaskPart> {
    Ok(TaskPart {
        id: r.get("id")?,
        task_id: r.get("task_id")?,
        title: r.get("title")?,
        weight: r.get("weight")?,
        done_at: r.get("done_at")?,
        sort_order: r.get("sort_order")?,
    })
}

fn task_from(r: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get("id")?,
        space_id: r.get("space_id")?,
        type_id: r.get("type_id")?,
        title: r.get("title")?,
        notes: r.get("notes")?,
        deadline_at: r.get("deadline_at")?,
        target_at: r.get("target_at")?,
        completed_at: r.get("completed_at")?,
        priority: r.get("priority")?,
        section_id: r.get("section_id")?,
        today_on: r.get("today_on")?,
        source_id: r.get("source_id")?,
        locally_modified: r.get("locally_modified")?,
        sort_order: r.get("sort_order")?,
        created_at: r.get("created_at")?,
        parts: Vec::new(),
    })
}

fn parts_of(c: &Connection, task_id: &str) -> Result<Vec<TaskPart>> {
    let mut s = c.prepare(
        "SELECT * FROM task_parts WHERE task_id = ?1 AND deleted_at IS NULL ORDER BY sort_order, created_at",
    )?;
    let rows = s.query_map([task_id], part_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// All tasks that are not archived, each with its parts. Completed tasks are included.
pub fn list_tasks(c: &Connection) -> Result<Vec<Task>> {
    let mut s = c.prepare("SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order, created_at")?;
    let mut tasks = s.query_map([], task_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    for t in &mut tasks {
        t.parts = parts_of(c, &t.id)?;
    }
    Ok(tasks)
}

pub fn get_task(c: &Connection, id: &str) -> Result<Task> {
    let mut t = c.query_row("SELECT * FROM tasks WHERE id = ?1", [id], task_from)?;
    t.parts = parts_of(c, id)?;
    Ok(t)
}

fn check_priority(p: &Option<String>) -> Result<()> {
    match p.as_deref() {
        None | Some("low") | Some("medium") | Some("high") => Ok(()),
        Some(other) => Err(AppError::Invalid(format!("Unknown priority: {other}"))),
    }
}

/// A section only counts when it belongs to the task's space; moving a task to another space
/// takes it out of its section.
fn section_in(c: &Connection, input: &TaskInput) -> Result<Option<String>> {
    let Some(section) = &input.section_id else { return Ok(None) };
    let space: Option<String> =
        c.query_row("SELECT space_id FROM sections WHERE id = ?1", [section], |r| r.get(0)).optional()?;
    Ok(if space.as_deref() == Some(input.space_id.as_str()) { Some(section.clone()) } else { None })
}

pub fn create_task(c: &Connection, input: TaskInput) -> Result<Task> {
    check_priority(&input.priority)?;
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO tasks (id, space_id, type_id, title, notes, deadline_at, target_at, priority, section_id, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![
            id,
            input.space_id,
            input.type_id,
            input.title.trim(),
            input.notes,
            input.deadline_at,
            input.target_at,
            input.priority,
            section_in(c, &input)?,
            next_sort(c, "tasks")?,
            ts
        ],
    )?;
    get_task(c, &id)
}

/// Changes a task, keeping its earlier version (see history.rs) when something differs.
pub fn update_task(c: &Connection, id: &str, input: TaskInput) -> Result<Task> {
    check_priority(&input.priority)?;
    let before = get_task(c, id)?;
    let same = before.space_id == input.space_id
        && before.type_id == input.type_id
        && before.title == input.title.trim()
        && before.notes == input.notes
        && before.deadline_at == input.deadline_at
        && before.target_at == input.target_at
        && before.priority == input.priority
        && before.section_id == section_in(c, &input)?;
    if same {
        return Ok(before);
    }
    if !crate::history::just_created(&before.created_at) {
        crate::history::remember(c, "task", id, &before, false)?;
    }
    update_task_unlogged(c, id, input)
}

/// Changes a task without keeping a version.
pub fn update_task_unlogged(c: &Connection, id: &str, input: TaskInput) -> Result<Task> {
    check_priority(&input.priority)?;
    changed(c.execute(
        "UPDATE tasks SET space_id = ?2, type_id = ?3, title = ?4, notes = ?5, deadline_at = ?6, target_at = ?7,
         priority = ?8, section_id = ?9, updated_at = ?10,
         locally_modified = (source_id IS NOT NULL) OR locally_modified WHERE id = ?1",
        params![id, input.space_id, input.type_id, input.title.trim(), input.notes, input.deadline_at, input.target_at, input.priority, section_in(c, &input)?, now()],
    )?)?;
    get_task(c, id)
}

/// Puts a to-do on Today (`day` is the local date) or takes it off (`None`). Not a change worth
/// keeping a version of.
pub fn set_task_today(c: &Connection, id: &str, day: Option<&str>) -> Result<Task> {
    if let Some(d) = day {
        if chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_err() {
            return Err(AppError::Invalid(format!("Not a date: {d}")));
        }
    }
    changed(c.execute("UPDATE tasks SET today_on = ?2, updated_at = ?3 WHERE id = ?1", params![id, day, now()])?)?;
    get_task(c, id)
}

/// For a task without parts. A task with parts follows its parts instead.
pub fn set_task_completed(c: &Connection, id: &str, completed: bool) -> Result<Task> {
    if !parts_of(c, id)?.is_empty() {
        return Err(AppError::Invalid("This task is completed by finishing its parts".into()));
    }
    let ts = now();
    let completed_at = if completed { Some(ts.as_str()) } else { None };
    changed(c.execute(
        "UPDATE tasks SET completed_at = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, completed_at, ts],
    )?)?;
    get_task(c, id)
}

/// A task with parts is complete exactly when every part is done.
fn sync_task_completion(c: &Connection, task_id: &str) -> Result<()> {
    let parts = parts_of(c, task_id)?;
    if parts.is_empty() {
        return Ok(());
    }
    let ts = now();
    if parts.iter().all(|p| p.done_at.is_some()) {
        c.execute(
            "UPDATE tasks SET completed_at = ?2, updated_at = ?2 WHERE id = ?1 AND completed_at IS NULL",
            params![task_id, ts],
        )?;
    } else {
        c.execute(
            "UPDATE tasks SET completed_at = NULL, updated_at = ?2 WHERE id = ?1 AND completed_at IS NOT NULL",
            params![task_id, ts],
        )?;
    }
    Ok(())
}

fn task_id_of_part(c: &Connection, part_id: &str) -> Result<String> {
    Ok(c.query_row("SELECT task_id FROM task_parts WHERE id = ?1", [part_id], |r| r.get(0))?)
}

pub fn create_task_part(c: &Connection, task_id: &str, input: TaskPartInput) -> Result<Task> {
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO task_parts (id, task_id, title, weight, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, task_id, non_empty(&input.title, "Title")?, input.weight, next_sort(c, "task_parts")?, ts],
    )?;
    sync_task_completion(c, task_id)?;
    get_task(c, task_id)
}

pub fn update_task_part(c: &Connection, id: &str, input: TaskPartInput) -> Result<Task> {
    changed(c.execute(
        "UPDATE task_parts SET title = ?2, weight = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, non_empty(&input.title, "Title")?, input.weight, now()],
    )?)?;
    get_task(c, &task_id_of_part(c, id)?)
}

pub fn set_part_done(c: &Connection, id: &str, done: bool) -> Result<Task> {
    let ts = now();
    let done_at = if done { Some(ts.as_str()) } else { None };
    changed(c.execute(
        "UPDATE task_parts SET done_at = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, done_at, ts],
    )?)?;
    let task_id = task_id_of_part(c, id)?;
    sync_task_completion(c, &task_id)?;
    get_task(c, &task_id)
}

// ---------- routines ----------

fn valid_time(t: &str) -> bool {
    let b = t.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && t[..2].parse::<u8>().map(|h| h < 24).unwrap_or(false)
        && t[3..].parse::<u8>().map(|m| m < 60).unwrap_or(false)
}

fn check_routine(input: &RoutineInput) -> Result<()> {
    if !valid_time(&input.start_time) || !valid_time(&input.end_time) {
        return Err(AppError::Invalid("Times must look like 07:30".into()));
    }
    if input.start_time == input.end_time {
        return Err(AppError::Invalid("A routine needs a start and an end that differ".into()));
    }
    if input.weekdays.is_empty() || !input.weekdays.chars().all(|ch| ('1'..='7').contains(&ch)) {
        return Err(AppError::Invalid("Pick at least one day".into()));
    }
    Ok(())
}

fn routine_from(r: &Row) -> rusqlite::Result<Routine> {
    Ok(Routine {
        id: r.get("id")?,
        name: r.get("name")?,
        space_id: r.get("space_id")?,
        start_time: r.get("start_time")?,
        end_time: r.get("end_time")?,
        weekdays: r.get("weekdays")?,
        sort_order: r.get("sort_order")?,
        items: Vec::new(),
    })
}

fn items_of(c: &Connection, routine_id: &str) -> Result<Vec<RoutineItem>> {
    let mut s = c.prepare(
        "SELECT * FROM routine_items WHERE routine_id = ?1 AND deleted_at IS NULL ORDER BY sort_order, created_at",
    )?;
    let rows = s
        .query_map([routine_id], |r| {
            Ok(RoutineItem {
                id: r.get("id")?,
                routine_id: r.get("routine_id")?,
                title: r.get("title")?,
                parent_id: r.get("parent_id")?,
                sort_order: r.get("sort_order")?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn list_routines(c: &Connection) -> Result<Vec<Routine>> {
    let mut s = c.prepare("SELECT * FROM routines WHERE deleted_at IS NULL ORDER BY start_time, sort_order")?;
    let mut routines = s.query_map([], routine_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    for r in &mut routines {
        r.items = items_of(c, &r.id)?;
    }
    Ok(routines)
}

pub fn get_routine(c: &Connection, id: &str) -> Result<Routine> {
    let mut r = c.query_row("SELECT * FROM routines WHERE id = ?1", [id], routine_from)?;
    r.items = items_of(c, id)?;
    Ok(r)
}

pub fn create_routine(c: &Connection, input: RoutineInput) -> Result<Routine> {
    check_routine(&input)?;
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO routines (id, name, start_time, end_time, weekdays, space_id, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![id, non_empty(&input.name, "Name")?, input.start_time, input.end_time, input.weekdays, input.space_id, next_sort(c, "routines")?, ts],
    )?;
    get_routine(c, &id)
}

pub fn update_routine(c: &Connection, id: &str, input: RoutineInput) -> Result<Routine> {
    check_routine(&input)?;
    changed(c.execute(
        "UPDATE routines SET name = ?2, start_time = ?3, end_time = ?4, weekdays = ?5, space_id = ?7, updated_at = ?6 WHERE id = ?1",
        params![id, non_empty(&input.name, "Name")?, input.start_time, input.end_time, input.weekdays, now(), input.space_id],
    )?)?;
    get_routine(c, id)
}

/// A step of a routine, or with `parent_id` a step under another step of the same routine.
pub fn create_routine_item(c: &Connection, routine_id: &str, title: &str, parent_id: Option<&str>) -> Result<Routine> {
    if let Some(p) = parent_id {
        let of: Option<String> =
            c.query_row("SELECT routine_id FROM routine_items WHERE id = ?1", [p], |r| r.get(0)).optional()?;
        if of.as_deref() != Some(routine_id) {
            return Err(AppError::Invalid("That step is not in this routine".into()));
        }
    }
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO routine_items (id, routine_id, title, parent_id, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, routine_id, non_empty(title, "Title")?, parent_id, next_sort(c, "routine_items")?, ts],
    )?;
    get_routine(c, routine_id)
}

pub fn update_routine_item(c: &Connection, id: &str, title: &str) -> Result<Routine> {
    changed(c.execute(
        "UPDATE routine_items SET title = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, non_empty(title, "Title")?, now()],
    )?)?;
    let routine_id: String = c.query_row("SELECT routine_id FROM routine_items WHERE id = ?1", [id], |r| r.get(0))?;
    get_routine(c, &routine_id)
}

/// Ids of the items checked on `day` (local date, 'YYYY-MM-DD').
pub fn list_routine_checks(c: &Connection, day: &str) -> Result<Vec<String>> {
    let mut s = c.prepare("SELECT item_id FROM routine_checks WHERE day = ?1 AND deleted_at IS NULL")?;
    let rows = s.query_map([day], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(rows)
}

pub fn set_routine_check(c: &Connection, item_id: &str, day: &str, checked: bool) -> Result<()> {
    let ts = now();
    if checked {
        c.execute(
            "INSERT INTO routine_checks (id, item_id, day, checked_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)
             ON CONFLICT (item_id, day) DO UPDATE SET deleted_at = NULL, checked_at = ?4, updated_at = ?4",
            params![new_id(), item_id, day, ts],
        )?;
    } else {
        c.execute(
            "UPDATE routine_checks SET deleted_at = ?3, updated_at = ?3 WHERE item_id = ?1 AND day = ?2",
            params![item_id, day, ts],
        )?;
    }
    Ok(())
}

// ---------- focus sessions ----------

fn focus_from(r: &Row) -> rusqlite::Result<FocusSession> {
    Ok(FocusSession {
        id: r.get("id")?,
        space_id: r.get("space_id")?,
        activity_id: r.get("activity_id")?,
        task_id: r.get("task_id")?,
        title: r.get("title")?,
        planned_minutes: r.get("planned_minutes")?,
        started_at: r.get("started_at")?,
        ended_at: r.get("ended_at")?,
        event_id: r.get("event_id")?,
    })
}

/// The session that is running now, if any.
pub fn active_focus(c: &Connection) -> Result<Option<FocusSession>> {
    Ok(c.query_row(
        "SELECT * FROM focus_sessions WHERE ended_at IS NULL AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1",
        [],
        focus_from,
    )
    .optional()?)
}

pub fn start_focus(c: &Connection, input: FocusInput) -> Result<FocusSession> {
    if active_focus(c)?.is_some() {
        return Err(AppError::Invalid("A focus session is already running".into()));
    }
    if !(1..=600).contains(&input.planned_minutes) {
        return Err(AppError::Invalid("Choose a length between 1 and 600 minutes".into()));
    }
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO focus_sessions (id, space_id, activity_id, task_id, title, planned_minutes, started_at, event_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7, ?7)",
        params![id, input.space_id, input.activity_id, input.task_id, input.title.trim(), input.planned_minutes, ts, input.event_id],
    )?;
    let mut ids: Vec<&String> = input.task_ids.iter().chain(input.task_id.iter()).collect();
    ids.dedup();
    for (i, t) in ids.into_iter().enumerate() {
        c.execute(
            "INSERT OR IGNORE INTO focus_session_tasks (session_id, task_id, sort_order) VALUES (?1, ?2, ?3)",
            params![id, t, i as i64],
        )?;
    }
    Ok(c.query_row("SELECT * FROM focus_sessions WHERE id = ?1", [&id], focus_from)?)
}

/// The to-dos picked for a session, in the order picked.
pub fn focus_tasks(c: &Connection, session_id: &str) -> Result<Vec<FocusTask>> {
    let mut s = c.prepare("SELECT task_id, done_at FROM focus_session_tasks WHERE session_id = ?1 ORDER BY sort_order")?;
    let rows = s
        .query_map([session_id], |r| Ok(FocusTask { task_id: r.get(0)?, done_at: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Ticks a to-do off during a session (or back on): the to-do itself is done, and the moment is
/// kept, so the session's time can be written per to-do.
pub fn set_focus_task_done(c: &Connection, session_id: &str, task_id: &str, done: bool, at: &str) -> Result<Task> {
    changed(c.execute(
        "UPDATE focus_session_tasks SET done_at = ?3 WHERE session_id = ?1 AND task_id = ?2",
        params![session_id, task_id, if done { Some(at) } else { None }],
    )?)?;
    let task = get_task(c, task_id)?;
    if task.parts.is_empty() {
        set_task_completed(c, task_id, done)
    } else if done {
        for p in task.parts.iter().filter(|p| p.done_at.is_none()) {
            set_part_done(c, &p.id, true)?;
        }
        get_task(c, task_id)
    } else {
        Ok(task)
    }
}

/// Ends the session and writes it to the calendar as an event with its real duration.
pub fn finish_focus(c: &Connection, id: &str) -> Result<Event> {
    finish_focus_at(c, id, &now())
}

/// Ends the session at `end` and writes it to the calendar.
pub fn finish_focus_at(c: &Connection, id: &str, end: &str) -> Result<Event> {
    let session = c.query_row(
        "SELECT * FROM focus_sessions WHERE id = ?1 AND ended_at IS NULL AND deleted_at IS NULL",
        [id],
        focus_from,
    )?;
    let ts = end.to_string();
    // Started from a planned block: that block becomes the session, with its real times,
    // so the time is not counted twice.
    if let Some(planned) = session.event_id.as_deref() {
        let updated = c.execute(
            "UPDATE events SET start_at = ?2, end_at = ?3, status = 'planned', updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
            params![planned, session.started_at, ts],
        )?;
        if updated == 1 {
            c.execute("UPDATE focus_sessions SET ended_at = ?2, updated_at = ?2 WHERE id = ?1", params![id, ts])?;
            return get_event(c, planned);
        }
    }
    // The calendar gets the time per to-do: from the start to the first one ticked off, from there
    // to the next, and what is left goes to the first one still open. Without to-dos: one event,
    // named after the session or its space (never just "Focus").
    let space_name: String = c.query_row("SELECT name FROM spaces WHERE id = ?1", [&session.space_id], |r| r.get(0)).unwrap_or_default();
    let fallback = if session.title.is_empty() { space_name } else { session.title.clone() };
    let picked = focus_tasks(c, id)?;
    let title_of = |task_id: &str| -> Result<String> {
        let t = get_task(c, task_id)?;
        Ok(if t.title.is_empty() { fallback.clone() } else { t.title })
    };
    let mut ticked: Vec<&FocusTask> = picked.iter().filter(|t| t.done_at.as_deref().is_some_and(|d| d > session.started_at.as_str() && d <= end)).collect();
    ticked.sort_by(|a, b| a.done_at.cmp(&b.done_at));
    let open_task = picked.iter().find(|t| t.done_at.is_none()).map(|t| t.task_id.clone()).or(session.task_id.clone());
    let mut pieces: Vec<(String, String, Option<String>)> = Vec::new(); // (from, to, task)
    let mut cursor = session.started_at.clone();
    for t in ticked {
        let at = t.done_at.clone().unwrap();
        pieces.push((cursor.clone(), at.clone(), Some(t.task_id.clone())));
        cursor = at;
    }
    pieces.push((cursor, ts.clone(), open_task));
    // Under a minute is not worth an event of its own: it goes to the next piece.
    let long = |a: &str, b: &str| -> bool {
        match (chrono::DateTime::parse_from_rfc3339(a), chrono::DateTime::parse_from_rfc3339(b)) {
            (Ok(a), Ok(b)) => (b - a).num_seconds() >= 60,
            _ => true,
        }
    };
    let mut events = Vec::new();
    let mut carry: Option<String> = None;
    for (i, (from, to, task)) in pieces.iter().enumerate() {
        let from = carry.take().unwrap_or_else(|| from.clone());
        let last = i + 1 == pieces.len();
        if !long(&from, to) && !(last && events.is_empty()) {
            carry = Some(from);
            continue;
        }
        let title = match task {
            Some(t) => title_of(t)?,
            None => fallback.clone(),
        };
        events.push(create_event(
            c,
            EventInput {
                space_id: session.space_id.clone(),
                activity_id: session.activity_id.clone(),
                title,
                start_at: from,
                end_at: to.clone(),
                all_day: false,
                notes: String::new(),
                status: "planned".into(),
                task_id: task.clone(),
                location: String::new(),
                reminders: Some(String::new()),
            },
            "focus",
        )?);
    }
    if let (Some(from), Some(prev)) = (carry, events.last_mut()) {
        // A short tail after the last tick belongs to the piece before it.
        let _ = from;
        c.execute("UPDATE events SET end_at = ?2, updated_at = ?2 WHERE id = ?1", params![prev.id, ts])?;
        *prev = get_event(c, &prev.id)?;
    }
    let event = events.pop().expect("at least one piece is written");
    c.execute(
        "UPDATE focus_sessions SET ended_at = ?2, event_id = ?3, updated_at = ?2 WHERE id = ?1",
        params![id, ts, event.id],
    )?;
    Ok(event)
}

/// Minutes past the planned end after which a running session counts as forgotten.
pub const FORGOTTEN_AFTER_MINUTES: i64 = 60;

/// A session left running long past its plan is saved by itself, with its planned length,
/// so a forgotten timer still leaves an event but does not inflate Insights.
/// Returns the event when it did so.
pub fn close_forgotten_focus(c: &Connection, now: chrono::DateTime<chrono::Utc>) -> Result<Option<Event>> {
    let Some(s) = active_focus(c)? else { return Ok(None) };
    let Ok(started) = chrono::DateTime::parse_from_rfc3339(&s.started_at) else { return Ok(None) };
    let planned_end = started.with_timezone(&chrono::Utc) + chrono::Duration::minutes(s.planned_minutes);
    if now < planned_end + chrono::Duration::minutes(FORGOTTEN_AFTER_MINUTES) {
        return Ok(None);
    }
    let end = planned_end.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    Ok(Some(finish_focus_at(c, &s.id, &end)?))
}

/// Stops the session without logging it. The row is kept, archived.
pub fn discard_focus(c: &Connection, id: &str) -> Result<()> {
    let ts = now();
    changed(c.execute(
        "UPDATE focus_sessions SET ended_at = ?2, deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND ended_at IS NULL",
        params![id, ts],
    )?)
}

// ---------- inbox ----------

/// Saves a quick note as a to-do in the hidden Inbox space, from where it can go on Today, be
/// ticked off or move to a course.
/// The interface reads a day, a time and a list of steps from the note first (quickNote.ts).
pub fn add_inbox(c: &Connection, text: &str, deadline_at: Option<String>, steps: &[String]) -> Result<Task> {
    let task = create_task(
        c,
        TaskInput { space_id: INBOX.into(), type_id: None, title: non_empty(text, "Note")?, notes: String::new(), deadline_at, target_at: None, priority: None, section_id: None },
    )?;
    let mut last = task;
    for s in steps.iter().filter(|s| !s.trim().is_empty()) {
        last = create_task_part(c, &last.id, TaskPartInput { title: s.clone(), weight: 1.0 })?;
    }
    Ok(last)
}

// ---------- reminder rules ----------

fn reminder_from(r: &Row) -> rusqlite::Result<ReminderRule> {
    Ok(ReminderRule {
        id: r.get("id")?,
        kind: r.get("kind")?,
        title: r.get("title")?,
        enabled: r.get("enabled")?,
        minutes_before: r.get("minutes_before")?,
        times: r.get("times")?,
        weekdays: r.get("weekdays")?,
        interval_minutes: r.get("interval_minutes")?,
        start_time: r.get("start_time")?,
        end_time: r.get("end_time")?,
        ask_confirm: r.get("ask_confirm")?,
    })
}

fn check_reminder(input: &ReminderRuleInput) -> Result<()> {
    let bad = |m: &str| Err(AppError::Invalid(m.into()));
    if input.weekdays.is_empty() || !input.weekdays.chars().all(|ch| ('1'..='7').contains(&ch)) {
        return bad("Pick at least one day");
    }
    match input.kind.as_str() {
        "event" => match input.minutes_before {
            Some(m) if (0..=240).contains(&m) => Ok(()),
            _ => bad("Choose between 0 and 240 minutes before"),
        },
        "times" => match input.times.as_deref() {
            Some(t) if !t.is_empty() && t.split(',').all(valid_time) => Ok(()),
            _ => bad("Give one or more times like 08:00"),
        },
        "interval" => {
            let ok_times = matches!((&input.start_time, &input.end_time), (Some(a), Some(b)) if valid_time(a) && valid_time(b) && a < b);
            match input.interval_minutes {
                Some(m) if (5..=720).contains(&m) && ok_times => Ok(()),
                Some(_) if ok_times => bad("Choose an interval between 5 and 720 minutes"),
                _ => bad("The start time must be before the end time"),
            }
        }
        "focus" => Ok(()),
        other => bad(&format!("Unknown reminder kind: {other}")),
    }
}

pub fn list_reminder_rules(c: &Connection) -> Result<Vec<ReminderRule>> {
    let mut s = c.prepare("SELECT * FROM reminder_rules WHERE deleted_at IS NULL ORDER BY sort_order, created_at")?;
    let rows = s.query_map([], reminder_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn get_reminder_rule(c: &Connection, id: &str) -> Result<ReminderRule> {
    Ok(c.query_row("SELECT * FROM reminder_rules WHERE id = ?1", [id], reminder_from)?)
}

pub fn create_reminder_rule(c: &Connection, input: ReminderRuleInput) -> Result<ReminderRule> {
    check_reminder(&input)?;
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO reminder_rules (id, kind, title, enabled, minutes_before, times, weekdays, interval_minutes, start_time, end_time, ask_confirm, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
        params![
            id, input.kind, non_empty(&input.title, "Title")?, input.enabled, input.minutes_before, input.times,
            input.weekdays, input.interval_minutes, input.start_time, input.end_time, input.ask_confirm, next_sort(c, "reminder_rules")?, ts
        ],
    )?;
    get_reminder_rule(c, &id)
}

pub fn update_reminder_rule(c: &Connection, id: &str, input: ReminderRuleInput) -> Result<ReminderRule> {
    check_reminder(&input)?;
    changed(c.execute(
        "UPDATE reminder_rules SET title = ?2, enabled = ?3, minutes_before = ?4, times = ?5, weekdays = ?6,
         interval_minutes = ?7, start_time = ?8, end_time = ?9, ask_confirm = ?10, updated_at = ?11 WHERE id = ?1",
        params![
            id, non_empty(&input.title, "Title")?, input.enabled, input.minutes_before, input.times, input.weekdays,
            input.interval_minutes, input.start_time, input.end_time, input.ask_confirm, now()
        ],
    )?)?;
    get_reminder_rule(c, id)
}

/// An imported event follows the calendar again from the next sync.
pub fn follow_import(c: &Connection, id: &str) -> Result<Event> {
    changed(c.execute(
        "UPDATE events SET locally_modified = 0, updated_at = ?2 WHERE id = ?1 AND source = 'import'",
        params![id, now()],
    )?)?;
    get_event(c, id)
}

// ---------- settings (key/value) ----------

pub fn get_setting(c: &Connection, key: &str) -> Result<Option<String>> {
    Ok(c.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

/// `None` clears the setting (the row keeps an empty value; nothing is removed).
pub fn set_setting(c: &Connection, key: &str, value: Option<&str>) -> Result<()> {
    c.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3",
        params![key, value.unwrap_or(""), now()],
    )?;
    Ok(())
}

// ---------- archive (soft delete) ----------

/// The only way anything "disappears". Sets or clears deleted_at; no row is ever removed.
/// The table that holds an entity, for archiving and deleting.
pub fn table_of(entity: &str) -> Result<&'static str> {
    Ok(match entity {
        "group" => "groups",
        "space" => "spaces",
        "activity" => "activities",
        "event" => "events",
        "task" => "tasks",
        "task_part" => "task_parts",
        "task_type" => "task_types",
        "routine" => "routines",
        "routine_item" => "routine_items",
        "reminder_rule" => "reminder_rules",
        "import_source" => "import_sources",
        "title_mapping" => "title_mappings",
        "semester" => "semesters",
        "section" => "sections",
        other => return Err(AppError::Invalid(format!("Unknown entity: {other}"))),
    })
}

pub fn set_archived(c: &Connection, entity: &str, id: &str, archived: bool) -> Result<()> {
    let table = table_of(entity)?;
    let ts = now();
    let deleted_at = if archived { Some(ts.as_str()) } else { None };
    changed(c.execute(
        &format!("UPDATE {table} SET deleted_at = ?2, updated_at = ?3 WHERE id = ?1"),
        params![id, deleted_at, ts],
    )?)?;
    if entity == "task_part" {
        sync_task_completion(c, &task_id_of_part(c, id)?)?;
    }
    // Bringing back an event a sync removed is the user's choice: from now on syncs leave it.
    if (entity == "event" || entity == "task") && !archived {
        c.execute(
            &format!("UPDATE {table} SET locally_modified = 1, removed_by_sync = 0 WHERE id = ?1 AND removed_by_sync = 1"),
            [id],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn input(start: &str, end: &str) -> EventInput {
        EventInput {
            space_id: "seed-space-personal".into(),
            activity_id: Some("seed-activity-study".into()),
            title: " Read chapter 3 ".into(),
            start_at: start.into(),
            end_at: end.into(),
            all_day: false,
            notes: String::new(),
            status: "planned".into(), task_id: None, location: String::new(), reminders: None }
    }

    #[test]
    fn seeds_exist() {
        let c = open_in_memory().unwrap();
        assert_eq!(list_activities(&c).unwrap().len(), 4);
        // Personal, Sleep, Travel and the hidden Inbox.
        assert_eq!(list_spaces(&c).unwrap().len(), 4);
        assert_eq!(list_groups(&c).unwrap().len(), 1);
    }

    fn todo(space: &str, title: &str, section: Option<&str>) -> TaskInput {
        TaskInput {
            space_id: space.into(), type_id: None, title: title.into(), notes: String::new(),
            deadline_at: None, target_at: None, priority: None, section_id: section.map(Into::into),
        }
    }

    #[test]
    fn a_quick_note_is_a_todo_in_the_inbox() {
        let c = open_in_memory().unwrap();
        let t = add_inbox(&c, "  Ask Lotte for the notes ", None, &[]).unwrap();
        assert_eq!((t.space_id.as_str(), t.title.as_str()), (INBOX, "Ask Lotte for the notes"));
        assert!(add_inbox(&c, "   ", None, &[]).is_err());
        let r = add_inbox(&c, "verslag afwerken", Some("2026-11-27T22:59:00.000Z".into()), &["inleiding".into(), "conclusie".into()]).unwrap();
        assert_eq!(r.deadline_at.as_deref(), Some("2026-11-27T22:59:00.000Z"));
        assert_eq!(r.parts.iter().map(|p| p.title.as_str()).collect::<Vec<_>>(), ["inleiding", "conclusie"]);
        let inbox = list_spaces(&c).unwrap().into_iter().find(|s| s.id == INBOX).unwrap();
        assert_eq!(inbox.kind, "inbox");
        // Renaming it leaves it the Inbox.
        let renamed = update_space(&c, INBOX, SpaceInput { group_id: None, name: "Notes".into(), color: "gray".into(), role: "normal".into(), icon: None, kind: Some("list".into()) }).unwrap();
        assert_eq!(renamed.kind, "inbox");
    }

    #[test]
    fn spaces_have_a_kind() {
        let c = open_in_memory().unwrap();
        let mk = |kind: Option<&str>| SpaceInput { group_id: None, name: "X".into(), color: "blue".into(), role: "normal".into(), icon: None, kind: kind.map(Into::into) };
        assert_eq!(create_space(&c, mk(None)).unwrap().kind, "list");
        let p = create_space(&c, mk(Some("project"))).unwrap();
        assert_eq!(p.kind, "project");
        assert_eq!(update_space(&c, &p.id, mk(None)).unwrap().kind, "project", "left out keeps it");
        assert_eq!(update_space(&c, &p.id, mk(Some("none"))).unwrap().kind, "none");
        assert!(create_space(&c, mk(Some("inbox"))).is_err());
        let kinds: Vec<(String, String)> = list_spaces(&c).unwrap().into_iter().map(|s| (s.id, s.kind)).collect();
        assert!(kinds.contains(&("seed-space-sleep".into(), "none".into())));
        assert!(kinds.contains(&("seed-space-personal".into(), "list".into())));
    }

    #[test]
    fn a_todo_sits_in_a_section_of_its_own_space_only() {
        let c = open_in_memory().unwrap();
        let sec = create_section(&c, "seed-space-personal", "02 Titration").unwrap();
        let t = create_task(&c, todo("seed-space-personal", "Lab report", Some(&sec.id))).unwrap();
        assert_eq!(t.section_id.as_deref(), Some(sec.id.as_str()));
        // Moving it to another space takes it out of the section.
        let moved = update_task(&c, &t.id, todo(INBOX, "Lab report", Some(&sec.id))).unwrap();
        assert_eq!(moved.section_id, None);
        assert_eq!(update_section(&c, &sec.id, " 03 Buffers ").unwrap().name, "03 Buffers");
        set_archived(&c, "section", &sec.id, true).unwrap();
        assert!(list_sections(&c).unwrap().is_empty());
    }

    #[test]
    fn a_todo_goes_on_today_and_off_again() {
        let c = open_in_memory().unwrap();
        let t = create_task(&c, todo("seed-space-personal", "Groceries", None)).unwrap();
        assert_eq!(t.today_on, None);
        assert_eq!(set_task_today(&c, &t.id, Some("2026-11-18")).unwrap().today_on.as_deref(), Some("2026-11-18"));
        assert!(set_task_today(&c, &t.id, Some("tomorrow")).is_err());
        assert_eq!(set_task_today(&c, &t.id, None).unwrap().today_on, None);
        // No version is kept for it.
        assert!(crate::history::list(&c, "task", &t.id).unwrap().is_empty());
    }

    #[test]
    fn a_routine_step_can_have_steps() {
        let c = open_in_memory().unwrap();
        let r = create_routine(&c, RoutineInput { name: "Morning".into(), start_time: "07:00".into(), end_time: "10:00".into(), weekdays: "1234567".into(), space_id: None }).unwrap();
        let r = create_routine_item(&c, &r.id, "Pack backpack", None).unwrap();
        let parent = r.items[0].id.clone();
        let r = create_routine_item(&c, &r.id, "Laptop", Some(&parent)).unwrap();
        assert_eq!(r.items[1].parent_id.as_deref(), Some(parent.as_str()));
        let other = create_routine(&c, RoutineInput { name: "Evening".into(), start_time: "20:00".into(), end_time: "22:00".into(), weekdays: "1234567".into(), space_id: None }).unwrap();
        assert!(create_routine_item(&c, &other.id, "Teeth", Some(&parent)).is_err());
    }

    #[test]
    fn an_event_is_found_by_id_until_archived() {
        let c = open_in_memory().unwrap();
        let e = create_event(&c, input("2026-11-11T08:00:00.000Z", "2026-11-11T09:00:00.000Z"), "manual").unwrap();
        assert_eq!(find_event(&c, &e.id).unwrap().map(|f| f.id), Some(e.id.clone()));
        set_archived(&c, "event", &e.id, true).unwrap();
        assert!(find_event(&c, &e.id).unwrap().is_none());
        assert!(find_event(&c, "no-such-event").unwrap().is_none());
    }

    #[test]
    fn event_lifecycle_never_deletes() {
        let c = open_in_memory().unwrap();
        let e = create_event(&c, input("2026-11-11T08:00:00.000Z", "2026-11-11T09:00:00.000Z"), "manual").unwrap();
        assert_eq!(e.title, "Read chapter 3");

        let (from, to) = ("2026-11-11T00:00:00.000Z", "2026-11-12T00:00:00.000Z");
        assert_eq!(list_events(&c, from, to).unwrap().len(), 1);
        // outside the range
        assert_eq!(list_events(&c, "2026-11-12T00:00:00.000Z", "2026-11-13T00:00:00.000Z").unwrap().len(), 0);

        let moved = update_event(&c, &e.id, input("2026-11-11T10:00:00.000Z", "2026-11-11T11:30:00.000Z")).unwrap();
        assert_eq!(moved.start_at, "2026-11-11T10:00:00.000Z");

        set_archived(&c, "event", &e.id, true).unwrap();
        assert_eq!(list_events(&c, from, to).unwrap().len(), 0);
        let rows: i64 = c.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1, "archiving keeps the row");

        set_archived(&c, "event", &e.id, false).unwrap();
        assert_eq!(list_events(&c, from, to).unwrap().len(), 1);
    }

    #[test]
    fn rejects_bad_input() {
        let c = open_in_memory().unwrap();
        assert!(create_event(&c, input("2026-11-11T09:00:00.000Z", "2026-11-11T09:00:00.000Z"), "manual").is_err());
        let mut no_space = input("2026-11-11T08:00:00.000Z", "2026-11-11T09:00:00.000Z");
        no_space.space_id = "missing".into();
        assert!(create_event(&c, no_space, "manual").is_err(), "an event needs an existing space");
        assert!(create_group(&c, GroupInput { name: "  ".into() }).is_err());
        assert!(set_archived(&c, "settings", "x", true).is_err());
    }

    #[test]
    fn task_progress_follows_parts() {
        let c = open_in_memory().unwrap();
        let t = create_task(
            &c,
            TaskInput {
                space_id: "seed-space-personal".into(),
                type_id: Some("seed-type-theory".into()),
                title: "Chapters 1-3".into(),
                notes: String::new(),
                deadline_at: Some("2026-12-01T22:59:00.000Z".into()),
                target_at: None,
                priority: Some("high".into()), section_id: None
            },
        )
        .unwrap();
        assert_eq!(t.priority.as_deref(), Some("high"));
        let mut bad = TaskInput { space_id: t.space_id.clone(), type_id: None, title: "x".into(), notes: String::new(), deadline_at: None, target_at: None, priority: Some("urgent".into()), section_id: None };
        assert!(update_task(&c, &t.id, bad.clone()).is_err(), "only low, medium, high");
        bad.priority = None;
        assert_eq!(update_task(&c, &t.id, bad).unwrap().priority, None);
        assert!(set_task_completed(&c, &t.id, true).unwrap().completed_at.is_some());
        set_task_completed(&c, &t.id, false).unwrap();

        let part = |title: &str| TaskPartInput { title: title.into(), weight: 1.0 };
        create_task_part(&c, &t.id, part("Chapter 1")).unwrap();
        let t2 = create_task_part(&c, &t.id, part("Chapter 2")).unwrap();
        assert_eq!(t2.parts.len(), 2);
        assert!(set_task_completed(&c, &t.id, true).is_err(), "parts decide completion");

        let (p1, p2) = (t2.parts[0].id.clone(), t2.parts[1].id.clone());
        assert!(set_part_done(&c, &p1, true).unwrap().completed_at.is_none());
        assert!(set_part_done(&c, &p2, true).unwrap().completed_at.is_some());

        // a new part reopens the task
        let t3 = create_task_part(&c, &t.id, part("Chapter 3")).unwrap();
        assert!(t3.completed_at.is_none());
        // archiving the open part completes it again, and the row stays
        set_archived(&c, "task_part", &t3.parts[2].id, true).unwrap();
        let t4 = get_task(&c, &t.id).unwrap();
        assert!(t4.completed_at.is_some());
        assert_eq!(t4.parts.len(), 2);
        let rows: i64 = c.query_row("SELECT COUNT(*) FROM task_parts", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 3);

        set_archived(&c, "task", &t.id, true).unwrap();
        assert!(list_tasks(&c).unwrap().is_empty());
        assert_eq!(list_task_types(&c).unwrap().len(), 3);
    }

    #[test]
    fn routines_and_checks() {
        let c = open_in_memory().unwrap();
        assert_eq!(list_routines(&c).unwrap().len(), 2);
        let bad = |start: &str, days: &str| RoutineInput { name: "X".into(), start_time: start.into(), end_time: "09:00".into(), weekdays: days.into(), space_id: None };
        assert!(create_routine(&c, bad("7:00", "12345")).is_err());
        assert!(create_routine(&c, bad("07:00", "")).is_err());
        assert!(create_routine(&c, bad("09:00", "1")).is_err());

        let r = create_routine_item(&c, "seed-routine-morning", "Medication", None).unwrap();
        let item = r.items[0].id.clone();
        set_routine_check(&c, &item, "2026-11-11", true).unwrap();
        set_routine_check(&c, &item, "2026-11-11", true).unwrap();
        assert_eq!(list_routine_checks(&c, "2026-11-11").unwrap(), vec![item.clone()]);
        assert!(list_routine_checks(&c, "2026-11-12").unwrap().is_empty(), "a new day starts unchecked");
        set_routine_check(&c, &item, "2026-11-11", false).unwrap();
        assert!(list_routine_checks(&c, "2026-11-11").unwrap().is_empty());
        set_routine_check(&c, &item, "2026-11-11", true).unwrap();
        let rows: i64 = c.query_row("SELECT COUNT(*) FROM routine_checks", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1, "one row per item per day, reused");
    }

    #[test]
    fn focus_from_a_planned_block_fills_that_block() {
        let c = open_in_memory().unwrap();
        let task = create_task(
            &c,
            TaskInput {
                space_id: "seed-space-personal".into(),
                type_id: None,
                title: "Essay".into(),
                notes: String::new(),
                deadline_at: None,
                target_at: None,
                priority: None, section_id: None
            },
        )
        .unwrap();
        let mut planned = input("2020-01-01T10:00:00.000Z", "2020-01-01T12:00:00.000Z");
        planned.task_id = Some(task.id.clone());
        let block = create_event(&c, planned, "manual").unwrap();
        assert_eq!(block.task_id.as_deref(), Some(task.id.as_str()));

        let s = start_focus(
            &c,
            FocusInput {
                space_id: "seed-space-personal".into(),
                activity_id: None,
                task_id: Some(task.id.clone()),
                event_id: Some(block.id.clone()),
                title: "Essay".into(),
                planned_minutes: 120, task_ids: Vec::new() },
        )
        .unwrap();
        c.execute("UPDATE focus_sessions SET started_at = '2020-01-01T10:10:00.000Z' WHERE id = ?1", [&s.id]).unwrap();
        let e = finish_focus_at(&c, &s.id, "2020-01-01T11:40:00.000Z").unwrap();
        assert_eq!(e.id, block.id, "no second event");
        assert_eq!((e.start_at.as_str(), e.end_at.as_str()), ("2020-01-01T10:10:00.000Z", "2020-01-01T11:40:00.000Z"));
        let count: i64 = c.query_row("SELECT COUNT(*) FROM events WHERE deleted_at IS NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn focus_time_goes_to_the_todos_ticked_off() {
        let c = open_in_memory().unwrap();
        let todo = |title: &str| create_task(&c, TaskInput { space_id: "seed-space-personal".into(), type_id: None, title: title.into(), notes: String::new(), deadline_at: None, target_at: None, priority: None, section_id: None }).unwrap().id;
        let (a, b, d) = (todo("Read chapter 4"), todo("Exercises 4.1"), todo("Summary"));
        let s = start_focus(&c, FocusInput { space_id: "seed-space-personal".into(), activity_id: None, task_id: None, event_id: None, title: String::new(), planned_minutes: 60, task_ids: vec![a.clone(), b.clone(), d.clone()] }).unwrap();
        c.execute("UPDATE focus_sessions SET started_at = '2020-01-01T10:00:00.000Z' WHERE id = ?1", [&s.id]).unwrap();
        assert_eq!(focus_tasks(&c, &s.id).unwrap().len(), 3);
        // Ticked off at 10:25 and 10:40; the rest of the time goes to the one still open.
        assert!(set_focus_task_done(&c, &s.id, &a, true, "2020-01-01T10:25:00.000Z").unwrap().completed_at.is_some());
        set_focus_task_done(&c, &s.id, &b, true, "2020-01-01T10:40:00.000Z").unwrap();
        finish_focus_at(&c, &s.id, "2020-01-01T11:00:00.000Z").unwrap();
        let events = list_events(&c, "2020-01-01T00:00:00.000Z", "2020-01-02T00:00:00.000Z").unwrap();
        let got: Vec<(&str, &str, &str, Option<&str>)> = events.iter().map(|e| (e.title.as_str(), &e.start_at[11..16], &e.end_at[11..16], e.task_id.as_deref())).collect();
        assert_eq!(got, [
            ("Read chapter 4", "10:00", "10:25", Some(a.as_str())),
            ("Exercises 4.1", "10:25", "10:40", Some(b.as_str())),
            ("Summary", "10:40", "11:00", Some(d.as_str())),
        ]);
        assert!(events.iter().all(|e| e.reminders.as_deref() == Some("")), "no reminders for time already spent");
    }

    #[test]
    fn a_focus_without_todos_is_named_after_its_space() {
        let c = open_in_memory().unwrap();
        let s = start_focus(&c, FocusInput { space_id: "seed-space-personal".into(), activity_id: None, task_id: None, event_id: None, title: String::new(), planned_minutes: 30, task_ids: Vec::new() }).unwrap();
        c.execute("UPDATE focus_sessions SET started_at = '2020-01-01T10:00:00.000Z' WHERE id = ?1", [&s.id]).unwrap();
        let e = finish_focus_at(&c, &s.id, "2020-01-01T10:30:00.000Z").unwrap();
        assert_eq!(e.title, "Personal");
    }

    #[test]
    fn focus_session_becomes_an_event() {
        let c = open_in_memory().unwrap();
        let input = || FocusInput {
            space_id: "seed-space-personal".into(),
            activity_id: Some("seed-activity-study".into()),
            task_id: None,
            event_id: None,
            title: String::new(),
            planned_minutes: 25, task_ids: Vec::new() };
        let s = start_focus(&c, input()).unwrap();
        assert!(start_focus(&c, input()).is_err(), "only one session at a time");
        assert_eq!(active_focus(&c).unwrap().unwrap().id, s.id);

        // pretend it started 30 minutes ago
        c.execute("UPDATE focus_sessions SET started_at = '2020-01-01T10:00:00.000Z' WHERE id = ?1", [&s.id]).unwrap();
        let e = finish_focus(&c, &s.id).unwrap();
        assert_eq!((e.source.as_str(), e.title.as_str()), ("focus", "Personal"));
        assert_eq!(e.start_at, "2020-01-01T10:00:00.000Z");
        assert!(active_focus(&c).unwrap().is_none());
        assert!(finish_focus(&c, &s.id).is_err(), "cannot finish twice");

        let s2 = start_focus(&c, input()).unwrap();
        discard_focus(&c, &s2.id).unwrap();

        // Forgotten: still running an hour past the plan -> saved with the planned length.
        let s3 = start_focus(&c, input()).unwrap();
        c.execute("UPDATE focus_sessions SET started_at = '2020-01-01T10:00:00.000Z' WHERE id = ?1", [&s3.id]).unwrap();
        let at = |s: &str| chrono::DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&chrono::Utc);
        assert!(close_forgotten_focus(&c, at("2020-01-01T11:20:00Z")).unwrap().is_none(), "55 min over: still running");
        let e = close_forgotten_focus(&c, at("2020-01-01T11:30:00Z")).unwrap().expect("saved by itself");
        assert_eq!((e.start_at.as_str(), e.end_at.as_str()), ("2020-01-01T10:00:00.000Z", "2020-01-01T10:25:00.000Z"));
        assert!(active_focus(&c).unwrap().is_none());
        assert!(active_focus(&c).unwrap().is_none());
        let rows: i64 = c.query_row("SELECT COUNT(*) FROM focus_sessions", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 3, "a discarded session is kept");
    }

    #[test]
    fn spaces_and_groups() {
        let c = open_in_memory().unwrap();
        let s = create_space(
            &c,
            SpaceInput { group_id: Some("seed-group-school".into()), name: "Analysis".into(), color: "green".into(), role: "normal".into(), icon: None, kind: None },
        )
        .unwrap();
        assert_eq!(s.sort_order, 3);
        set_archived(&c, "space", &s.id, true).unwrap();
        let all = list_spaces(&c).unwrap();
        assert!(all.iter().any(|x| x.id == s.id && x.deleted_at.is_some()), "archived spaces stay listed");
    }

    #[test]
    fn space_icons_and_order() {
        let c = open_in_memory().unwrap();
        let seeds = list_spaces(&c).unwrap();
        let sleep = seeds.iter().find(|s| s.id == "seed-space-sleep").unwrap();
        assert_eq!(sleep.icon.as_deref(), Some("moon"), "the seeds get an icon");

        let input = |icon: Option<&str>| SpaceInput {
            group_id: None, name: "Chemistry".into(), color: "teal".into(), role: "normal".into(), icon: icon.map(Into::into), kind: None
        };
        let s = create_space(&c, input(Some("flask"))).unwrap();
        assert_eq!(s.icon.as_deref(), Some("flask"));
        assert!(update_space(&c, &s.id, input(Some("<svg>"))).is_err());
        assert_eq!(update_space(&c, &s.id, input(Some(""))).unwrap().icon, None);

        // Chemistry and Personal swap places; Sleep and Transport stay where they are.
        let before: Vec<String> = list_spaces(&c).unwrap().into_iter().map(|x| x.id).filter(|id| id != INBOX).collect();
        assert_eq!(before, ["seed-space-personal", "seed-space-sleep", "seed-space-transport", s.id.as_str()]);
        reorder_spaces(&c, &[s.id.clone(), "seed-space-personal".into()]).unwrap();
        let after: Vec<Space> = list_spaces(&c).unwrap().into_iter().filter(|x| x.id != INBOX).collect();
        let order: Vec<&str> = after.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(order, [s.id.as_str(), "seed-space-sleep", "seed-space-transport", "seed-space-personal"]);
        let numbers: Vec<i64> = after.iter().map(|x| x.sort_order).collect();
        assert_eq!(numbers, [0, 1, 2, 3], "one numbering for all spaces, no ties");
    }

    #[test]
    fn spaces_move_between_groups_and_groups_reorder() {
        let c = open_in_memory().unwrap();
        let school = list_groups(&c).unwrap()[0].clone();
        let other = create_group(&c, GroupInput { name: "Life".into() }).unwrap();
        let input = |g: Option<&str>, n: &str| SpaceInput { group_id: g.map(Into::into), name: n.into(), color: "teal".into(), role: "normal".into(), icon: None, kind: None };
        let chem = create_space(&c, input(Some(&school.id), "Chemistry")).unwrap();

        // Out of School, in front of Personal among the spaces without a group.
        move_space(&c, &chem.id, None, &[chem.id.clone(), "seed-space-personal".into()]).unwrap();
        let spaces = list_spaces(&c).unwrap();
        assert_eq!(spaces.iter().find(|s| s.id == chem.id).unwrap().group_id, None);
        let loose: Vec<&str> = spaces.iter().filter(|s| s.group_id.is_none() && s.id != INBOX).map(|s| s.id.as_str()).collect();
        assert_eq!(loose[0], chem.id, "it lands where it was dropped");

        // Into Life; a group that does not exist is refused.
        move_space(&c, &chem.id, Some(&other.id), &[chem.id.clone()]).unwrap();
        assert_eq!(get_space(&c, &chem.id).unwrap().group_id.as_deref(), Some(other.id.as_str()));
        assert!(move_space(&c, &chem.id, Some("nope"), &[chem.id.clone()]).is_err());

        // Life before School.
        reorder_groups(&c, &[other.id.clone(), school.id.clone()]).unwrap();
        let groups: Vec<String> = list_groups(&c).unwrap().into_iter().map(|g| g.id).collect();
        assert_eq!(groups, [other.id.clone(), school.id.clone()]);
    }
}
