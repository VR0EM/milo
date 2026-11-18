//! The archive: everything that was ever archived, in one list, so it can be found and
//! restored. Restoring is `repo::set_archived(.., false)`.

use crate::error::{AppError, Result};
use crate::models::{ArchiveKind, ArchivePage, ArchivedItem};
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

/// (entity, SQL returning id, label, context, when, archived_at, removed_by_sync)
const SOURCES: &[(&str, &str)] = &[
    ("space", "SELECT id, name, NULL, NULL, deleted_at, 0 FROM spaces WHERE deleted_at IS NOT NULL"),
    ("group", "SELECT id, name, NULL, NULL, deleted_at, 0 FROM groups WHERE deleted_at IS NOT NULL"),
    ("activity", "SELECT id, name, NULL, NULL, deleted_at, 0 FROM activities WHERE deleted_at IS NOT NULL"),
    ("task", "SELECT t.id, t.title, s.name, t.deadline_at, t.deleted_at, 0 FROM tasks t JOIN spaces s ON s.id = t.space_id WHERE t.deleted_at IS NOT NULL AND NOT IN_ARCHIVED_SOURCE(t)"),
    ("task_part", "SELECT p.id, p.title, t.title, NULL, p.deleted_at, 0 FROM task_parts p JOIN tasks t ON t.id = p.task_id WHERE p.deleted_at IS NOT NULL"),
    ("task_type", "SELECT id, name, NULL, NULL, deleted_at, 0 FROM task_types WHERE deleted_at IS NOT NULL"),
    ("section", "SELECT x.id, x.name, s.name, NULL, x.deleted_at, 0 FROM sections x JOIN spaces s ON s.id = x.space_id WHERE x.deleted_at IS NOT NULL"),
    ("routine", "SELECT id, name, start_time || '–' || end_time, NULL, deleted_at, 0 FROM routines WHERE deleted_at IS NOT NULL"),
    ("routine_item", "SELECT i.id, i.title, r.name, NULL, i.deleted_at, 0 FROM routine_items i JOIN routines r ON r.id = i.routine_id WHERE i.deleted_at IS NOT NULL"),
    ("reminder_rule", "SELECT id, title, NULL, NULL, deleted_at, 0 FROM reminder_rules WHERE deleted_at IS NOT NULL"),
    ("import_source", "SELECT id, name, location, NULL, deleted_at, 0 FROM import_sources WHERE deleted_at IS NOT NULL"),
    ("title_mapping", "SELECT m.id, m.pattern, s.name, NULL, m.deleted_at, 0 FROM title_mappings m JOIN spaces s ON s.id = m.space_id WHERE m.deleted_at IS NOT NULL"),
    ("semester", "SELECT id, name, start_date || ' – ' || end_date, NULL, deleted_at, 0 FROM semesters WHERE deleted_at IS NOT NULL"),
    ("event", "SELECT e.id, e.title, s.name, e.start_at, e.deleted_at, e.removed_by_sync FROM events e JOIN spaces s ON s.id = e.space_id WHERE e.deleted_at IS NOT NULL AND e.replaced = 0 AND NOT IN_ARCHIVED_SOURCE(e)"),
];

/// Everything archived as one table `a(entity, id, label, context, at, archived, sync)`,
/// narrowed to labels containing ?1 (lower case, "" for all).
fn archived_cte() -> String {
    // Events and to-dos of an archived calendar are listed as that one calendar, not one by one.
    let in_archived_source = |x: &str| format!("EXISTS (SELECT 1 FROM import_sources src WHERE src.id = {x}.source_id AND src.deleted_at IS NOT NULL)");
    let parts: Vec<String> = SOURCES
        .iter()
        .map(|(e, sql)| {
            sql.replacen("SELECT ", &format!("SELECT '{e}', "), 1)
                .replace("IN_ARCHIVED_SOURCE(t)", &in_archived_source("t"))
                .replace("IN_ARCHIVED_SOURCE(e)", &in_archived_source("e"))
        })
        .collect();
    format!(
        "WITH all_archived(entity, id, label, context, at, archived, sync) AS ({}),
         a AS (SELECT * FROM all_archived WHERE ?1 = '' OR instr(lower(label), ?1) > 0)",
        parts.join(" UNION ALL ")
    )
}

fn item(r: &rusqlite::Row) -> rusqlite::Result<ArchivedItem> {
    Ok(ArchivedItem {
        entity: r.get(0)?,
        id: r.get(1)?,
        label: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
        context: r.get(3)?,
        when: r.get(4)?,
        archived_at: r.get(5)?,
        removed_by_sync: r.get(6)?,
    })
}

/// One page of the archive, newest first: what matches `query` (by name, any case) and `kind`
/// (an entity, or "" for all), from `offset`, at most `limit`. Also how many match in all and
/// how many of each kind match the query, so the list never has to be loaded whole.
pub fn page(c: &Connection, query: &str, kind: &str, limit: i64, offset: i64) -> Result<ArchivePage> {
    let q = query.trim().to_lowercase();
    let cte = archived_cte();
    let kinds: Vec<ArchiveKind> = c
        .prepare(&format!("{cte} SELECT entity, COUNT(*) FROM a GROUP BY entity ORDER BY COUNT(*) DESC"))?
        .query_map([&q], |r| Ok(ArchiveKind { entity: r.get(0)?, count: r.get(1)? }))?
        .collect::<rusqlite::Result<_>>()?;
    let total = kinds.iter().filter(|k| kind.is_empty() || k.entity == kind).map(|k| k.count).sum();
    let items = c
        .prepare(&format!(
            "{cte} SELECT * FROM a WHERE ?2 = '' OR entity = ?2 ORDER BY archived DESC, entity, id LIMIT ?3 OFFSET ?4"
        ))?
        .query_map(rusqlite::params![q, kind, limit.max(0), offset.max(0)], item)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ArchivePage { items, total, kinds })
}

/// Everything archived whose label contains `query`, newest first (for clean-ups and tests).
pub fn list_archived(c: &Connection, query: &str) -> Result<Vec<ArchivedItem>> {
    Ok(page(c, query, "", i64::MAX, 0)?.items)
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
                let_go_of_event(c, id)?;
            }
            "task" => let_go_of_task(c, id)?,
            "import_source" => {
                // Its events and to-dos go with it; anything brought back on its own stays,
                // as an ordinary event or to-do.
                for t in ["events", "tasks"] {
                    c.execute(&format!("UPDATE {t} SET source_id = NULL, external_uid = NULL WHERE source_id = ?1 AND deleted_at IS NULL"), [id])?;
                }
                let ids = |sql: &str| -> Result<Vec<String>> {
                    Ok(c.prepare(sql)?.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?)
                };
                for e in ids("SELECT id FROM events WHERE source_id = ?1")? {
                    let_go_of_event(c, &e)?;
                    c.execute("DELETE FROM change_log WHERE entity_id = ?1", [&e])?;
                    c.execute("DELETE FROM events WHERE id = ?1", [&e])?;
                }
                for t in ids("SELECT id FROM tasks WHERE source_id = ?1")? {
                    let_go_of_task(c, &t)?;
                    c.execute("DELETE FROM change_log WHERE entity_id = ?1", [&t])?;
                    c.execute("DELETE FROM tasks WHERE id = ?1", [&t])?;
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

/// Clears what points at an event that is about to be deleted.
fn let_go_of_event(c: &Connection, id: &str) -> Result<()> {
    c.execute("UPDATE focus_sessions SET event_id = NULL WHERE event_id = ?1", [id])?;
    Ok(())
}

/// Deletes a to-do's parts and clears what points at it, before the to-do itself is deleted.
fn let_go_of_task(c: &Connection, id: &str) -> Result<()> {
    c.execute("DELETE FROM change_log WHERE entity_id IN (SELECT id FROM task_parts WHERE task_id = ?1)", [id])?;
    c.execute("DELETE FROM task_parts WHERE task_id = ?1", [id])?;
    c.execute("UPDATE events SET task_id = NULL WHERE task_id = ?1", [id])?;
    c.execute("UPDATE focus_sessions SET task_id = NULL WHERE task_id = ?1", [id])?;
    c.execute("DELETE FROM focus_session_tasks WHERE task_id = ?1", [id])?;
    // An older trial table some databases still have.
    if has_table(c, "proposals")? {
        c.execute("DELETE FROM proposals WHERE task_id = ?1", [id])?;
    }
    Ok(())
}

fn has_table(c: &Connection, name: &str) -> Result<bool> {
    Ok(c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)", [name], |r| r.get(0))?)
}

/// Deletes for good everything that was archived before `before` (ISO time) and can go.
/// Returns how many items went; what must stay archived is left without complaint.
pub fn delete_archived_before(c: &Connection, before: &str) -> Result<usize> {
    let mut gone = 0;
    for i in list_archived(c, "")?.into_iter().filter(|i| i.archived_at.as_str() < before) {
        if delete_forever(c, &i.entity, &i.id).is_ok() {
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
                all_day: false, notes: String::new(), status: "planned".into(), task_id: None, location: String::new(), reminders: None },
            "manual",
        )
        .unwrap();
        repo::set_archived(&c, "event", &e.id, true).unwrap();
        repo::set_archived(&c, "activity", "seed-activity-exam", true).unwrap();

        let items = list_archived(&c, "").unwrap();
        assert_eq!(items.iter().map(|i| i.entity.as_str()).collect::<Vec<_>>().len(), 2);
        assert!(items.iter().any(|i| i.entity == "event" && i.label == "Dentist" && i.context.as_deref() == Some("Personal")));

        assert_eq!(list_archived(&c, "dent").unwrap().len(), 1);
        assert_eq!(list_archived(&c, "EXAM").unwrap().len(), 1);

        repo::set_archived(&c, "event", &e.id, false).unwrap();
        assert!(list_archived(&c, "dent").unwrap().is_empty());
    }

    #[test]
    fn restoring_a_synced_away_event_keeps_it() {
        let c = open_in_memory().unwrap();
        let e = repo::create_event(
            &c,
            EventInput {
                space_id: "seed-space-personal".into(), activity_id: None, title: "Lecture".into(),
                start_at: "2030-01-01T08:00:00.000Z".into(), end_at: "2030-01-01T09:00:00.000Z".into(),
                all_day: false, notes: String::new(), status: "planned".into(), task_id: None, location: String::new(), reminders: None },
            "manual",
        )
        .unwrap();
        c.execute("UPDATE events SET source = 'import', deleted_at = '2026-01-01T00:00:00.000Z', removed_by_sync = 1 WHERE id = ?1", [&e.id]).unwrap();
        assert!(list_archived(&c, "").unwrap()[0].removed_by_sync);
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
                all_day: false, notes: String::new(), status: "planned".into(), task_id: None, location: String::new(), reminders: None },
            "manual",
        )
        .unwrap()
        .id
    }

    #[test]
    fn the_archive_comes_in_pages_with_counts_per_kind() {
        let c = open_in_memory().unwrap();
        for n in 0..120 {
            let e = event(&c, &format!("Plan {n}"));
            repo::set_archived(&c, "event", &e, true).unwrap();
            c.execute("UPDATE events SET deleted_at = ?1 WHERE id = ?2", [format!("2026-01-01T00:{:02}:{:02}.000Z", n / 60, n % 60), e]).unwrap();
        }
        repo::set_archived(&c, "activity", "seed-activity-exam", true).unwrap();
        repo::set_archived(&c, "space", "seed-space-transport", true).unwrap();

        let first = page(&c, "", "", 50, 0).unwrap();
        assert_eq!((first.items.len(), first.total), (50, 122));
        assert_eq!(first.kinds[0].entity, "event");
        assert_eq!(first.kinds[0].count, 120);
        assert_eq!(first.kinds.len(), 3);
        // Newest first: the two archived just now, then the latest plan.
        assert!(first.items[..2].iter().all(|i| i.entity != "event"));
        assert_eq!(first.items[2].label, "Plan 119");

        let last = page(&c, "", "", 50, 100).unwrap();
        assert_eq!(last.items.len(), 22);
        assert_eq!(last.items.last().unwrap().label, "Plan 0");

        let events = page(&c, "", "event", 500, 0).unwrap();
        assert_eq!((events.items.len(), events.total), (120, 120));
        let found = page(&c, "PLAN 11", "", 50, 0).unwrap();
        assert_eq!(found.total, 11, "Plan 11 and Plan 110 to 119");
        assert_eq!(page(&c, "exam", "event", 50, 0).unwrap().total, 0);
        assert_eq!(page(&c, "exam", "", 50, 0).unwrap().kinds.len(), 1);
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

    fn count(c: &Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn a_calendar_imported_twice_goes_away_with_its_events() {
        let c = open_in_memory().unwrap();
        for src in ["first", "second"] {
            c.execute(&format!("INSERT INTO import_sources (id, kind, name, location, space_id, enabled, created_at, updated_at) VALUES ('{src}', 'ics_url', 'Timetable', 'https://x', 'seed-space-personal', 1, '2026-01-01', '2026-01-01')"), []).unwrap();
            for n in 0..3 {
                let e = event(&c, &format!("Class {n}"));
                c.execute("UPDATE events SET source = 'import', source_id = ?1, external_uid = ?2 WHERE id = ?3", [src, &n.to_string(), &e]).unwrap();
            }
        }
        // One the user changed, and one a sync had already removed.
        c.execute("UPDATE events SET locally_modified = 1 WHERE source_id = 'second' AND external_uid = '0'", []).unwrap();
        c.execute("UPDATE events SET deleted_at = '2026-02-01T00:00:00.000Z', removed_by_sync = 1 WHERE source_id = 'second' AND external_uid = '2'", []).unwrap();
        let live = |c: &Connection| count(c, "SELECT COUNT(*) FROM events WHERE deleted_at IS NULL");
        assert_eq!(live(&c), 5);

        repo::set_archived(&c, "import_source", "second", true).unwrap();
        assert_eq!(live(&c), 3, "the copy's classes leave the calendar");
        let listed = list_archived(&c, "").unwrap();
        assert_eq!(listed.len(), 1, "the archive shows the calendar, not each class");
        assert_eq!(listed[0].entity, "import_source");

        repo::set_archived(&c, "import_source", "second", false).unwrap();
        assert_eq!(live(&c), 5, "bringing it back brings back what went with it, not what a sync removed");

        repo::set_archived(&c, "import_source", "second", true).unwrap();
        delete_forever(&c, "import_source", "second").unwrap();
        assert_eq!(count(&c, "SELECT COUNT(*) FROM events WHERE source_id = 'second'"), 0);
        assert_eq!(count(&c, "SELECT COUNT(*) FROM import_sources WHERE id = 'second'"), 0);
        assert_eq!(live(&c), 3);
        assert!(list_archived(&c, "").unwrap().is_empty());
    }

    #[test]
    fn the_update_archives_classes_of_calendars_archived_before() {
        let c = open_in_memory().unwrap();
        c.execute("INSERT INTO import_sources (id, kind, name, location, space_id, enabled, created_at, updated_at, deleted_at) VALUES ('old', 'ics_url', 'Timetable', 'https://x', 'seed-space-personal', 1, '2026-01-01', '2026-01-01', '2026-11-18T05:30:00.000Z')", []).unwrap();
        let e = event(&c, "Class");
        let mine = event(&c, "Mine");
        c.execute("UPDATE events SET source_id = 'old', external_uid = '1' WHERE id = ?1", [&e]).unwrap();
        c.execute_batch(include_str!("db/migrations/015_archived_calendars.sql")).unwrap();
        assert_eq!(count(&c, "SELECT COUNT(*) FROM events WHERE deleted_at = '2026-11-18T05:30:00.000Z'"), 1);
        assert!(repo::get_event(&c, &mine).unwrap().deleted_at.is_none());
        repo::set_archived(&c, "import_source", "old", false).unwrap();
        assert!(repo::get_event(&c, &e).unwrap().deleted_at.is_none());
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
