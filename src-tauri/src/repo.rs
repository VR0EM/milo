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

pub fn create_space(c: &Connection, input: SpaceInput) -> Result<Space> {
    one_of(&input.role, &["normal", "sleep"], "role")?;
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO spaces (id, group_id, name, color, role, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            input.group_id,
            non_empty(&input.name, "Name")?,
            input.color,
            input.role,
            next_sort(c, "spaces")?,
            ts
        ],
    )?;
    get_space(c, &id)
}

pub fn update_space(c: &Connection, id: &str, input: SpaceInput) -> Result<Space> {
    one_of(&input.role, &["normal", "sleep"], "role")?;
    changed(c.execute(
        "UPDATE spaces SET group_id = ?2, name = ?3, color = ?4, role = ?5, updated_at = ?6 WHERE id = ?1",
        params![id, input.group_id, non_empty(&input.name, "Name")?, input.color, input.role, now()],
    )?)?;
    get_space(c, id)
}

// ---------- activities ----------

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
        status: r.get("status")?,
        source: r.get("source")?,
        source_id: r.get("source_id")?,
        locally_modified: r.get("locally_modified")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        deleted_at: r.get("deleted_at")?,
    })
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

pub fn create_event(c: &Connection, input: EventInput, source: &str) -> Result<Event> {
    check_event(&input)?;
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO events (id, space_id, activity_id, title, start_at, end_at, all_day, notes, status, source, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
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
            ts
        ],
    )?;
    get_event(c, &id)
}

pub fn update_event(c: &Connection, id: &str, input: EventInput) -> Result<Event> {
    check_event(&input)?;
    changed(c.execute(
        "UPDATE events SET space_id = ?2, activity_id = ?3, title = ?4, start_at = ?5, end_at = ?6,
         all_day = ?7, notes = ?8, status = ?9, updated_at = ?10,
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
            now()
        ],
    )?)?;
    get_event(c, id)
}

// ---------- task types ----------

fn task_type_from(r: &Row) -> rusqlite::Result<TaskType> {
    Ok(TaskType {
        id: r.get("id")?,
        name: r.get("name")?,
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
        "INSERT INTO task_types (id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, non_empty(&input.name, "Name")?, next_sort(c, "task_types")?, ts],
    )?;
    get_task_type(c, &id)
}

pub fn update_task_type(c: &Connection, id: &str, input: TaskTypeInput) -> Result<TaskType> {
    changed(c.execute(
        "UPDATE task_types SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, non_empty(&input.name, "Name")?, now()],
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

pub fn create_task(c: &Connection, input: TaskInput) -> Result<Task> {
    check_priority(&input.priority)?;
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO tasks (id, space_id, type_id, title, notes, deadline_at, target_at, priority, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            id,
            input.space_id,
            input.type_id,
            input.title.trim(),
            input.notes,
            input.deadline_at,
            input.target_at,
            input.priority,
            next_sort(c, "tasks")?,
            ts
        ],
    )?;
    get_task(c, &id)
}

pub fn update_task(c: &Connection, id: &str, input: TaskInput) -> Result<Task> {
    check_priority(&input.priority)?;
    changed(c.execute(
        "UPDATE tasks SET space_id = ?2, type_id = ?3, title = ?4, notes = ?5, deadline_at = ?6, target_at = ?7,
         priority = ?8, updated_at = ?9 WHERE id = ?1",
        params![id, input.space_id, input.type_id, input.title.trim(), input.notes, input.deadline_at, input.target_at, input.priority, now()],
    )?)?;
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
        "INSERT INTO routines (id, name, start_time, end_time, weekdays, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, non_empty(&input.name, "Name")?, input.start_time, input.end_time, input.weekdays, next_sort(c, "routines")?, ts],
    )?;
    get_routine(c, &id)
}

pub fn update_routine(c: &Connection, id: &str, input: RoutineInput) -> Result<Routine> {
    check_routine(&input)?;
    changed(c.execute(
        "UPDATE routines SET name = ?2, start_time = ?3, end_time = ?4, weekdays = ?5, updated_at = ?6 WHERE id = ?1",
        params![id, non_empty(&input.name, "Name")?, input.start_time, input.end_time, input.weekdays, now()],
    )?)?;
    get_routine(c, id)
}

pub fn create_routine_item(c: &Connection, routine_id: &str, title: &str) -> Result<Routine> {
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO routine_items (id, routine_id, title, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, routine_id, non_empty(title, "Title")?, next_sort(c, "routine_items")?, ts],
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
        "INSERT INTO focus_sessions (id, space_id, activity_id, task_id, title, planned_minutes, started_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7)",
        params![id, input.space_id, input.activity_id, input.task_id, input.title.trim(), input.planned_minutes, ts],
    )?;
    Ok(c.query_row("SELECT * FROM focus_sessions WHERE id = ?1", [&id], focus_from)?)
}

/// Ends the session and writes it to the calendar as an event with its real duration.
pub fn finish_focus(c: &Connection, id: &str) -> Result<Event> {
    let session = c.query_row(
        "SELECT * FROM focus_sessions WHERE id = ?1 AND ended_at IS NULL AND deleted_at IS NULL",
        [id],
        focus_from,
    )?;
    let ts = now();
    let event = create_event(
        c,
        EventInput {
            space_id: session.space_id,
            activity_id: session.activity_id,
            title: if session.title.is_empty() { "Focus".into() } else { session.title },
            start_at: session.started_at,
            end_at: ts.clone(),
            all_day: false,
            notes: String::new(),
            status: "planned".into(),
        },
        "focus",
    )?;
    c.execute(
        "UPDATE focus_sessions SET ended_at = ?2, event_id = ?3, updated_at = ?2 WHERE id = ?1",
        params![id, ts, event.id],
    )?;
    Ok(event)
}

/// Stops the session without logging it. The row is kept, archived.
pub fn discard_focus(c: &Connection, id: &str) -> Result<()> {
    let ts = now();
    changed(c.execute(
        "UPDATE focus_sessions SET ended_at = ?2, deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND ended_at IS NULL",
        params![id, ts],
    )?)
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
        "INSERT INTO reminder_rules (id, kind, title, enabled, minutes_before, times, weekdays, interval_minutes, start_time, end_time, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        params![
            id, input.kind, non_empty(&input.title, "Title")?, input.enabled, input.minutes_before, input.times,
            input.weekdays, input.interval_minutes, input.start_time, input.end_time, next_sort(c, "reminder_rules")?, ts
        ],
    )?;
    get_reminder_rule(c, &id)
}

pub fn update_reminder_rule(c: &Connection, id: &str, input: ReminderRuleInput) -> Result<ReminderRule> {
    check_reminder(&input)?;
    changed(c.execute(
        "UPDATE reminder_rules SET title = ?2, enabled = ?3, minutes_before = ?4, times = ?5, weekdays = ?6,
         interval_minutes = ?7, start_time = ?8, end_time = ?9, updated_at = ?10 WHERE id = ?1",
        params![
            id, non_empty(&input.title, "Title")?, input.enabled, input.minutes_before, input.times, input.weekdays,
            input.interval_minutes, input.start_time, input.end_time, now()
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

// ---------- archive (soft delete) ----------

/// The only way anything "disappears". Sets or clears deleted_at; no row is ever removed.
pub fn set_archived(c: &Connection, entity: &str, id: &str, archived: bool) -> Result<()> {
    let table = match entity {
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
        other => return Err(AppError::Invalid(format!("Unknown entity: {other}"))),
    };
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
    if entity == "event" && !archived {
        c.execute(
            "UPDATE events SET locally_modified = 1, removed_by_sync = 0 WHERE id = ?1 AND removed_by_sync = 1",
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
            status: "planned".into(),
        }
    }

    #[test]
    fn seeds_exist() {
        let c = open_in_memory().unwrap();
        assert_eq!(list_activities(&c).unwrap().len(), 4);
        assert_eq!(list_spaces(&c).unwrap().len(), 3);
        assert_eq!(list_groups(&c).unwrap().len(), 1);
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
                priority: Some("high".into()),
            },
        )
        .unwrap();
        assert_eq!(t.priority.as_deref(), Some("high"));
        let mut bad = TaskInput { space_id: t.space_id.clone(), type_id: None, title: "x".into(), notes: String::new(), deadline_at: None, target_at: None, priority: Some("urgent".into()) };
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
        let bad = |start: &str, days: &str| RoutineInput { name: "X".into(), start_time: start.into(), end_time: "09:00".into(), weekdays: days.into() };
        assert!(create_routine(&c, bad("7:00", "12345")).is_err());
        assert!(create_routine(&c, bad("07:00", "")).is_err());
        assert!(create_routine(&c, bad("09:00", "1")).is_err());

        let r = create_routine_item(&c, "seed-routine-morning", "Medication").unwrap();
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
    fn focus_session_becomes_an_event() {
        let c = open_in_memory().unwrap();
        let input = || FocusInput {
            space_id: "seed-space-personal".into(),
            activity_id: Some("seed-activity-study".into()),
            task_id: None,
            title: String::new(),
            planned_minutes: 25,
        };
        let s = start_focus(&c, input()).unwrap();
        assert!(start_focus(&c, input()).is_err(), "only one session at a time");
        assert_eq!(active_focus(&c).unwrap().unwrap().id, s.id);

        // pretend it started 30 minutes ago
        c.execute("UPDATE focus_sessions SET started_at = '2020-01-01T10:00:00.000Z' WHERE id = ?1", [&s.id]).unwrap();
        let e = finish_focus(&c, &s.id).unwrap();
        assert_eq!((e.source.as_str(), e.title.as_str()), ("focus", "Focus"));
        assert_eq!(e.start_at, "2020-01-01T10:00:00.000Z");
        assert!(active_focus(&c).unwrap().is_none());
        assert!(finish_focus(&c, &s.id).is_err(), "cannot finish twice");

        let s2 = start_focus(&c, input()).unwrap();
        discard_focus(&c, &s2.id).unwrap();
        assert!(active_focus(&c).unwrap().is_none());
        let rows: i64 = c.query_row("SELECT COUNT(*) FROM focus_sessions", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 2, "a discarded session is kept");
    }

    #[test]
    fn spaces_and_groups() {
        let c = open_in_memory().unwrap();
        let s = create_space(
            &c,
            SpaceInput { group_id: Some("seed-group-school".into()), name: "Analysis".into(), color: "green".into(), role: "normal".into() },
        )
        .unwrap();
        assert_eq!(s.sort_order, 3);
        set_archived(&c, "space", &s.id, true).unwrap();
        let all = list_spaces(&c).unwrap();
        assert!(all.iter().any(|x| x.id == s.id && x.deleted_at.is_some()), "archived spaces stay listed");
    }
}
