//! The archive: everything that was ever archived, in one list, so it can be found and
//! restored. Restoring is `repo::set_archived(.., false)`.

use crate::error::Result;
use crate::models::ArchivedItem;
use rusqlite::Connection;

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
         WHERE e.deleted_at IS NOT NULL AND lower(e.title) LIKE ?1 ORDER BY e.deleted_at DESC LIMIT ?2",
        &[&like, &EVENT_LIMIT],
    )?;
    let total: i64 = c.query_row(
        "SELECT COUNT(*) FROM events WHERE deleted_at IS NOT NULL AND lower(title) LIKE ?1",
        [&like],
        |r| r.get(0),
    )?;
    let hidden = total - events.len() as i64;
    items.extend(events);
    items.sort_by(|a, b| b.archived_at.cmp(&a.archived_at));
    Ok((items, hidden))
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
                all_day: false, notes: String::new(), status: "planned".into(),
            },
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
                all_day: false, notes: String::new(), status: "planned".into(),
            },
            "manual",
        )
        .unwrap();
        c.execute("UPDATE events SET source = 'import', deleted_at = '2026-01-01T00:00:00.000Z', removed_by_sync = 1 WHERE id = ?1", [&e.id]).unwrap();
        assert!(list_archived(&c, "").unwrap().0[0].removed_by_sync);
        repo::set_archived(&c, "event", &e.id, false).unwrap();
        let back = repo::get_event(&c, &e.id).unwrap();
        assert!(back.locally_modified, "a restored event is the user's choice, so syncs leave it");
    }
}
