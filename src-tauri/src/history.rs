//! Earlier versions of events and tasks. Before an edit changes one, its current state is kept
//! as JSON, so the edit can be undone later. Edits in quick succession (dragging, typing) are
//! one version: a new one is kept only when the last is older than `BURST_SECONDS`.
//! Restoring is an edit too, so a restore can itself be undone.

use crate::db::{new_id, now};
use crate::error::{AppError, Result};
use crate::models::{Change, EventInput, TaskInput};
use crate::repo;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

const BURST_SECONDS: i64 = 120;
/// How many versions are listed per item. All are kept.
const LIST_LIMIT: i64 = 20;

/// Whether an item was made so recently that changing it still counts as making it (a new
/// event gets its title right after it appears). Such changes keep no earlier version.
pub fn just_created(created_at: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(created_at).is_ok_and(|t| {
        let age = (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds();
        (0..BURST_SECONDS).contains(&age)
    })
}

/// Keeps `snapshot` as a version of `entity`/`id`, unless the last version is very recent.
pub fn remember(c: &Connection, entity: &str, id: &str, snapshot: &impl serde::Serialize, force: bool) -> Result<()> {
    if !force {
        let last: Option<String> = c
            .query_row(
                "SELECT created_at FROM change_log WHERE entity = ?1 AND entity_id = ?2 ORDER BY created_at DESC LIMIT 1",
                params![entity, id],
                |r| r.get(0),
            )
            .optional()?;
        let recent = last
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(&t).ok())
            .is_some_and(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds() < BURST_SECONDS);
        if recent {
            return Ok(());
        }
    }
    let json = serde_json::to_string(snapshot).map_err(|e| AppError::Invalid(e.to_string()))?;
    c.execute(
        "INSERT INTO change_log (id, entity, entity_id, snapshot, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![new_id(), entity, id, json, now()],
    )?;
    Ok(())
}

/// The newest versions of one item, newest first.
pub fn list(c: &Connection, entity: &str, id: &str) -> Result<Vec<Change>> {
    let mut s = c.prepare(
        "SELECT id, created_at, snapshot FROM change_log WHERE entity = ?1 AND entity_id = ?2 ORDER BY created_at DESC LIMIT ?3",
    )?;
    let rows = s
        .query_map(params![entity, id, LIST_LIMIT], |r| {
            let snapshot: String = r.get(2)?;
            Ok(Change { id: r.get(0)?, created_at: r.get(1)?, snapshot: serde_json::from_str(&snapshot).unwrap_or(Value::Null) })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}
fn maybe(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string)
}

/// Puts an item back the way a kept version has it. Returns which item it was.
pub fn restore(c: &Connection, change_id: &str) -> Result<(String, String)> {
    let (entity, entity_id, snapshot): (String, String, String) = c
        .query_row("SELECT entity, entity_id, snapshot FROM change_log WHERE id = ?1", [change_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?
        .ok_or(AppError::NotFound)?;
    let v: Value = serde_json::from_str(&snapshot).map_err(|e| AppError::Invalid(e.to_string()))?;
    match entity.as_str() {
        "event" => {
            let input = EventInput {
                space_id: text(&v, "spaceId"),
                activity_id: maybe(&v, "activityId"),
                title: text(&v, "title"),
                start_at: text(&v, "startAt"),
                end_at: text(&v, "endAt"),
                all_day: v.get("allDay").and_then(Value::as_bool).unwrap_or(false),
                notes: text(&v, "notes"),
                status: maybe(&v, "status").unwrap_or_else(|| "planned".into()),
                task_id: maybe(&v, "taskId"),
            };
            remember(c, "event", &entity_id, &repo::get_event(c, &entity_id)?, true)?;
            repo::update_event_unlogged(c, &entity_id, input)?;
        }
        "task" => {
            let input = TaskInput {
                space_id: text(&v, "spaceId"),
                type_id: maybe(&v, "typeId"),
                title: text(&v, "title"),
                notes: text(&v, "notes"),
                deadline_at: maybe(&v, "deadlineAt"),
                target_at: maybe(&v, "targetAt"),
                priority: maybe(&v, "priority"),
            };
            remember(c, "task", &entity_id, &repo::get_task(c, &entity_id)?, true)?;
            repo::update_task_unlogged(c, &entity_id, input)?;
        }
        other => return Err(AppError::Invalid(format!("Cannot restore a {other}"))),
    }
    Ok((entity, entity_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn event(c: &Connection) -> crate::models::Event {
        repo::create_event(
            c,
            EventInput {
                space_id: "seed-space-personal".into(),
                activity_id: None,
                title: "Physics".into(),
                start_at: "2030-01-07T08:00:00.000Z".into(),
                end_at: "2030-01-07T10:00:00.000Z".into(),
                all_day: false,
                notes: "room B1".into(),
                status: "planned".into(),
                task_id: None,
            },
            "manual",
        )
        .unwrap()
    }

    fn edit(c: &Connection, id: &str, title: &str, start: &str) {
        let e = repo::get_event(c, id).unwrap();
        repo::update_event(
            c,
            id,
            EventInput { space_id: e.space_id, activity_id: e.activity_id, title: title.into(), start_at: start.into(), end_at: e.end_at, all_day: e.all_day, notes: String::new(), status: e.status, task_id: e.task_id },
        )
        .unwrap();
    }

    /// An event made a while ago, so edits to it keep versions.
    fn old_event(c: &Connection) -> crate::models::Event {
        let e = event(c);
        c.execute("UPDATE events SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1", [&e.id]).unwrap();
        repo::get_event(c, &e.id).unwrap()
    }

    #[test]
    fn naming_a_new_item_keeps_no_version() {
        let c = open_in_memory().unwrap();
        let e = event(&c);
        edit(&c, &e.id, "Physics, room B1", "2030-01-07T08:00:00.000Z");
        assert!(list(&c, "event", &e.id).unwrap().is_empty());
    }

    #[test]
    fn an_edit_can_be_undone_and_the_undo_too() {
        let c = open_in_memory().unwrap();
        let e = old_event(&c);
        edit(&c, &e.id, "Physics moved", "2030-01-07T09:00:00.000Z");
        // A second edit right after is part of the same burst: still one version.
        edit(&c, &e.id, "Physics moved again", "2030-01-07T09:30:00.000Z");
        let versions = list(&c, "event", &e.id).unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].snapshot["title"], "Physics");

        restore(&c, &versions[0].id).unwrap();
        let back = repo::get_event(&c, &e.id).unwrap();
        assert_eq!((back.title.as_str(), back.start_at.as_str(), back.notes.as_str()), ("Physics", "2030-01-07T08:00:00.000Z", "room B1"));

        // The state before the restore was kept as well, so the restore can be undone.
        let versions = list(&c, "event", &e.id).unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].snapshot["title"], "Physics moved again");
    }

    #[test]
    fn saving_without_a_change_keeps_no_version() {
        let c = open_in_memory().unwrap();
        let e = old_event(&c);
        let same = EventInput {
            space_id: e.space_id.clone(), activity_id: None, title: e.title.clone(), start_at: e.start_at.clone(),
            end_at: e.end_at.clone(), all_day: false, notes: e.notes.clone(), status: e.status.clone(), task_id: None,
        };
        repo::update_event(&c, &e.id, same).unwrap();
        assert!(list(&c, "event", &e.id).unwrap().is_empty());
    }
}
