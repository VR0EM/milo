//! The archive: everything that was ever archived, in one list, so it can be found and
//! restored. Restoring is `repo::set_archived(.., false)`.

use crate::error::{AppError, Result};
use crate::models::ArchivedItem;
use crate::repo;
use rusqlite::{Connection, OptionalExtension};

/// Settings key: after how many days archived items go for good (absent = never).
pub const KEEP_SETTING: &str = "archive_keep_days";

/// The daily clean-up, right after the daily backup: what was archived longer ago than the
/// chosen number of days goes for good. Returns how many items went.
pub fn clean_up(c: &Connection, now: chrono::DateTime<chrono::Utc>) -> Result<usize> {
    let Some(days) = repo::get_setting(c, KEEP_SETTING)?.and_then(|v| v.parse::<i64>().ok()).filter(|d| *d > 0) else {
        return Ok(0);
    };
    let before = (now - chrono::Duration::days(days)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    delete_archived_before(c, &before)
}

/// Archived events can be many; the newest are listed and the rest counted.
const EVENT_LIMIT: i64 = 300;

/// (entity, SQL returning id, label, context, when, archived_at, removed_by_sync)
const SOURCES: &[(&str, &str)] = &[
    ("space", "SELECT id, name, NULL, NULL, deleted_at, 0 FROM spaces WHERE deleted_at IS NOT NULL"),
    ("group", "SELECT id, name, NULL, NULL, deleted_at, 0 FROM groups WHERE deleted_at IS NOT NULL"),
    ("activity", "SELECT id, name, NULL, NULL, deleted_at, 0 FROM activities WHERE deleted_at IS NOT NULL"),
    ("task", "SELECT t.id, t.title, s.name, t.deadline_at, t.deleted_at, 0 FROM tasks t JOIN spaces s ON s.id = t.space_id WHERE t.deleted_at IS NOT NULL"),
    ("task_part", "SELECT p.id, p.title, t.title, NULL, p.deleted_at, 0 FROM task_parts p JOIN tasks t ON t.id = p.task_id WHERE p.deleted_at IS NOT NULL"),
    ("task_type", "SELECT id, name, NULL, NULL, deleted_at, 0 FROM task_types WHERE deleted_at IS NOT NULL"),
    ("section", "SELECT x.id, x.name, s.name, NULL, x.deleted_at, 0 FROM sections x JOIN spaces s ON s.id = x.space_id WHERE x.deleted_at IS NOT NULL"),
    ("routine", "SELECT id, name, start_time || '–' || end_time, NULL, deleted_at, 0 FROM routines WHERE deleted_at IS NOT NULL"),
    ("routine_item", "SELECT i.id, i.title, r.name, NULL, i.deleted_at, 0 FROM routine_items i JOIN routines r ON r.id = i.routine_id WHERE i.deleted_at IS NOT NULL"),
    ("reminder_rule", "SELECT id, title, NULL, NULL, deleted_at, 0 FROM reminder_rules WHERE deleted_at IS NOT NULL"),
    ("import_source", "SELECT id, name, location, NULL, deleted_at, 0 FROM import_sources WHERE deleted_at IS NOT NULL"),
    ("title_mapping", "SELECT m.id, m.pattern, s.name, NULL, m.deleted_at, 0 FROM title_mappings m JOIN spaces s ON s.id = m.space_id WHERE m.deleted_at IS NOT NULL"),
    ("semester", "SELECT id, name, start_date || ' – ' || end_date, NULL, deleted_at, 0 FROM semesters WHERE deleted_at IS NOT NULL"),
];

fn read(c: &Connection, entity: &str, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Result<Vec<ArchivedItem>> {
    let mut s = c.prepare(sql)?;
    let rows = s
        .query_map(params, |r| {
            Ok(ArchivedItem {
                entity: entity.to_string(),
                id: r.get(0)?,
                label: r.get::<_, String>(1)?,
                context: r.get(2)?,
                when: r.get(3)?,
                archived_at: r.get(4)?,
                removed_by_sync: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Everything archived whose label contains `query` (case-insensitive), newest first,
/// plus how many archived events were left out by the limit.
pub fn list_archived(c: &Connection, query: &str) -> Result<(Vec<ArchivedItem>, i64)> {
    let q = query.trim().to_lowercase();
    let mut items = Vec::new();
    for (entity, sql) in SOURCES {
        items.extend(read(c, entity, sql, &[])?.into_iter().filter(|i| q.is_empty() || i.label.to_lowercase().contains(&q)));
    }

    let like = format!("%{q}%");
    let events = read(
        c,
        "event",
        "SELECT e.id, e.title, s.name, e.start_at, e.deleted_at, e.removed_by_sync FROM events e JOIN spaces s ON s.id = e.space_id
         WHERE e.deleted_at IS NOT NULL AND e.replaced = 0 AND lower(e.title) LIKE ?1 ORDER BY e.deleted_at DESC LIMIT ?2",
        &[&like, &EVENT_LIMIT],
    )?;
    let total: i64 = c.query_row(
        "SELECT COUNT(*) FROM events WHERE deleted_at IS NOT NULL AND replaced = 0 AND lower(title) LIKE ?1",
        [&like],
        |r| r.get(0),
    )?;
    let hidden = total - events.len() as i64;
    items.extend(events);
    items.sort_by(|a, b| b.archived_at.cmp(&a.archived_at));
    Ok((items, hidden))
}

/// Removes an archived item for good, with what only belonged to it (a task's parts, a routine's
/// items, earlier versions). Something still used elsewhere (a space with events, an activity
/// events are counted under) stays archived, and an imported event too, so the calendar link
/// does not bring it back. Nothing that is not archived can be deleted.
pub fn delete_forever(c: &Connection, entity: &str, id: &str) -> Result<()> {
    let table = repo::table_of(entity)?;
    let archived: Option<Option<String>> = c
        .query_row(&format!("SELECT deleted_at FROM {table} WHERE id = ?1"), [id], |r| r.get(0))
        .optional()?;
    match archived {
        None => return Err(AppError::Invalid("It is already gone".into())),
        Some(None) => return Err(AppError::Invalid("Only archived items can be deleted for good".into())),
        Some(Some(_)) => {}
    }
    // All or nothing for this one item.
    c.execute_batch("SAVEPOINT forever")?;
    let done = (|| -> Result<()> {
        match entity {
            "event" => {
                let imported: bool = c.query_row("SELECT source_id IS NOT NULL FROM events WHERE id = ?1", [id], |r| r.get(0))?;
                if imported {
                    return Err(AppError::Invalid("An imported event stays archived, so its calendar link does not add it again".into()));
                }
                c.execute("UPDATE focus_sessions SET event_id = NULL WHERE event_id = ?1", [id])?;
            }
            "task" => {
                c.execute("DELETE FROM change_log WHERE entity_id IN (SELECT id FROM task_parts WHERE task_id = ?1)", [id])?;
                c.execute("DELETE FROM task_parts WHERE task_id = ?1", [id])?;
                c.execute("UPDATE events SET task_id = NULL WHERE task_id = ?1", [id])?;
                c.execute("UPDATE focus_sessions SET task_id = NULL WHERE task_id = ?1", [id])?;
                // An older trial table some databases still have.
                if has_table(c, "proposals")? {
                    c.execute("DELETE FROM proposals WHERE task_id = ?1", [id])?;
                }
            }
            "routine" => {
                c.execute("DELETE FROM routine_checks WHERE item_id IN (SELECT id FROM routine_items WHERE routine_id = ?1)", [id])?;
                c.execute("DELETE FROM routine_items WHERE routine_id = ?1", [id])?;
            }
            "routine_item" => {
                c.execute("DELETE FROM routine_checks WHERE item_id = ?1", [id])?;
                c.execute("UPDATE routine_items SET parent_id = NULL WHERE parent_id = ?1", [id])?;
            }
            "section" => {
                c.execute("UPDATE tasks SET section_id = NULL WHERE section_id = ?1", [id])?;
            }
            "reminder_rule" => {
                c.execute("DELETE FROM reminder_log WHERE rule_id = ?1", [id])?;
            }
            _ => {}
        }
        c.execute("DELETE FROM change_log WHERE entity_id = ?1", [id])?;
        match c.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id]) {
            Ok(_) => Ok(()),
            Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == rusqlite::ErrorCode::ConstraintViolation => {
                Err(AppError::Invalid("It is still used by other things in Milo, so it stays archived".into()))
            }
            Err(e) => Err(e.into()),
        }
    })();
    match done {
        Ok(()) => c.execute_batch("RELEASE forever")?,
        Err(e) => {
            c.execute_batch("ROLLBACK TO forever; RELEASE forever")?;
            return Err(e);
        }
    }
    Ok(())
}

fn has_table(c: &Connection, name: &str) -> Result<bool> {
    Ok(c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)", [name], |r| r.get(0))?)
}

/// Deletes for good everything that was archived before `before` (ISO time) and can go.
/// Returns how many items went; what must stay archived is left without complaint.
pub fn delete_archived_before(c: &Connection, before: &str) -> Result<usize> {
    let (items, _) = list_archived(c, "")?;
    let mut gone = 0;
    // Events beyond the listing limit are counted too.
    let mut ids: Vec<(String, String)> = items.into_iter().filter(|i| i.archived_at.as_str() < before).map(|i| (i.entity, i.id)).collect();
    let extra: Vec<String> = c
        .prepare("SELECT id FROM events WHERE deleted_at IS NOT NULL AND deleted_at < ?1 AND source_id IS NULL")?
        .query_map([before], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for id in extra {
        if !ids.iter().any(|(_, x)| *x == id) {
            ids.push(("event".into(), id));
        }
    }
    for (entity, id) in ids {
        if delete_forever(c, &entity, &id).is_ok() {
            gone += 1;
        }
    }
    Ok(gone)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::models::*;
    use crate::repo;

    #[test]
    fn lists_and_restores() {
        let c = open_in_memory().unwrap();
        let e = repo::create_event(
            &c,
            EventInput {
                space_id: "seed-space-personal".into(), activity_id: None, title: "Dentist".into(),
                start_at: "2026-11-11T08:00:00.000Z".into(), end_at: "2026-11-11T09:00:00.000Z".into(),
                all_day: false, notes: String::new(), status: "planned".into(), task_id: None, location: String::new() },
            "manual",
        )
        .unwrap();
        repo::set_archived(&c, "event", &e.id, true).unwrap();
        repo::set_archived(&c, "activity", "seed-activity-exam", true).unwrap();

        let (items, hidden) = list_archived(&c, "").unwrap();
        assert_eq!(hidden, 0);
        assert_eq!(items.iter().map(|i| i.entity.as_str()).collect::<Vec<_>>().len(), 2);
        assert!(items.iter().any(|i| i.entity == "event" && i.label == "Dentist" && i.context.as_deref() == Some("Personal")));

        assert_eq!(list_archived(&c, "dent").unwrap().0.len(), 1);
        assert_eq!(list_archived(&c, "EXAM").unwrap().0.len(), 1);

        repo::set_archived(&c, "event", &e.id, false).unwrap();
        assert!(list_archived(&c, "dent").unwrap().0.is_empty());
    }

    #[test]
    fn restoring_a_synced_away_event_keeps_it() {
        let c = open_in_memory().unwrap();
        let e = repo::create_event(
            &c,
            EventInput {
                space_id: "seed-space-personal".into(), activity_id: None, title: "Lecture".into(),
                start_at: "2030-01-01T08:00:00.000Z".into(), end_at: "2030-01-01T09:00:00.000Z".into(),
                all_day: false, notes: String::new(), status: "planned".into(), task_id: None, location: String::new() },
            "manual",
        )
        .unwrap();
        c.execute("UPDATE events SET source = 'import', deleted_at = '2026-01-01T00:00:00.000Z', removed_by_sync = 1 WHERE id = ?1", [&e.id]).unwrap();
        assert!(list_archived(&c, "").unwrap().0[0].removed_by_sync);
        repo::set_archived(&c, "event", &e.id, false).unwrap();
        let back = repo::get_event(&c, &e.id).unwrap();
        assert!(back.locally_modified, "a restored event is the user's choice, so syncs leave it");
    }

    fn event(c: &Connection, title: &str) -> String {
        repo::create_event(
            c,
            EventInput {
                space_id: "seed-space-personal".into(), activity_id: None, title: title.into(),
                start_at: "2026-11-11T08:00:00.000Z".into(), end_at: "2026-11-11T09:00:00.000Z".into(),
                all_day: false, notes: String::new(), status: "planned".into(), task_id: None, location: String::new() },
            "manual",
        )
        .unwrap()
        .id
    }

    #[test]
    fn deletes_for_good_only_what_is_archived_and_free() {
        let c = open_in_memory().unwrap();
        let e = event(&c, "Old plan");
        assert!(delete_forever(&c, "event", &e).is_err(), "not archived yet");
        repo::set_archived(&c, "event", &e, true).unwrap();
        delete_forever(&c, "event", &e).unwrap();
        let left: i64 = c.query_row("SELECT COUNT(*) FROM events WHERE id = ?1", [&e], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);

        // A space with an event in it stays, also when archived.
        repo::set_archived(&c, "space", "seed-space-transport", true).unwrap();
        let busy = event(&c, "Train");
        c.execute("UPDATE events SET space_id = 'seed-space-transport' WHERE id = ?1", [&busy]).unwrap();
        assert!(delete_forever(&c, "space", "seed-space-transport").is_err());
        let still: i64 = c.query_row("SELECT COUNT(*) FROM spaces WHERE id = 'seed-space-transport'", [], |r| r.get(0)).unwrap();
        assert_eq!(still, 1, "nothing half-deleted");

        // An imported event stays archived, so a sync does not bring it back.
        let imp = event(&c, "Lecture");
        c.execute("INSERT INTO import_sources (id, kind, name, location, space_id, enabled, created_at, updated_at) VALUES ('src', 'ics_url', 'School', 'https://x', 'seed-space-personal', 1, '2026-01-01', '2026-01-01')", []).unwrap();
        c.execute("UPDATE events SET source_id = 'src' WHERE id = ?1", [&imp]).unwrap();
        repo::set_archived(&c, "event", &imp, true).unwrap();
        assert!(delete_forever(&c, "event", &imp).is_err());
    }

    #[test]
    fn a_task_goes_with_its_parts() {
        let c = open_in_memory().unwrap();
        let t = repo::create_task(
            &c,
            TaskInput { space_id: "seed-space-personal".into(), type_id: None, title: "Essay".into(), notes: String::new(), deadline_at: None, target_at: None, priority: None, section_id: None },
        )
        .unwrap();
        repo::create_task_part(&c, &t.id, TaskPartInput { title: "Intro".into(), weight: 1.0 }).unwrap();
        repo::set_archived(&c, "task", &t.id, true).unwrap();
        assert_eq!(delete_archived_before(&c, "2999-01-01").unwrap(), 1);
        let parts: i64 = c.query_row("SELECT COUNT(*) FROM task_parts WHERE task_id = ?1", [&t.id], |r| r.get(0)).unwrap();
        assert_eq!(parts, 0);
        assert_eq!(delete_archived_before(&c, "2000-01-01").unwrap(), 0, "nothing archived that long ago");
    }

    #[test]
    fn the_daily_clean_up_follows_the_setting() {
        let c = open_in_memory().unwrap();
        let old = event(&c, "Long ago");
        let recent = event(&c, "Last week");
        c.execute("UPDATE events SET deleted_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1", [&old]).unwrap();
        c.execute("UPDATE events SET deleted_at = '2026-11-10T00:00:00.000Z' WHERE id = ?1", [&recent]).unwrap();
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-15T12:00:00Z").unwrap().with_timezone(&chrono::Utc);
        assert_eq!(clean_up(&c, now).unwrap(), 0, "never, unless chosen");
        repo::set_setting(&c, KEEP_SETTING, Some("30")).unwrap();
        assert_eq!(clean_up(&c, now).unwrap(), 1);
        let left: Vec<String> = c.prepare("SELECT id FROM events").unwrap().query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        assert!(left.contains(&recent) && !left.contains(&old));
    }
}
