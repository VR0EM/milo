//! Search: every event (any date, also long past) and every to-do (also done), by the words in
//! its title, notes, location, steps, space or activity. Capitals and accents do not matter, and
//! every word typed must be found. The repeats of one event (a weekly class) come back as one
//! result: how often, the last time and the next time.

use crate::error::Result;
use crate::suggest::normalize;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;

const LIMIT: usize = 100;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct When {
    pub event_id: String,
    pub start_at: String,
    pub all_day: bool,
}

/// One event, or all the events with the same title in the same space.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventHit {
    pub title: String,
    pub space_id: String,
    pub location: String,
    pub count: usize,
    /// The latest one that has started; None when all are still to come.
    pub last: Option<When>,
    /// The first one still to come; None when all are past.
    pub next: Option<When>,
    /// The words are in the title (not only in the notes or the place).
    pub in_title: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskHit {
    pub id: String,
    pub title: String,
    pub space_id: String,
    pub deadline_at: Option<String>,
    pub completed_at: Option<String>,
    pub in_title: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SearchResults {
    pub events: Vec<EventHit>,
    pub tasks: Vec<TaskHit>,
}

fn has_all(hay: &str, words: &[&str]) -> bool {
    words.iter().all(|w| hay.contains(w))
}

pub fn search(c: &Connection, query: &str, now: &str) -> Result<SearchResults> {
    let q = normalize(query);
    let words: Vec<&str> = q.split(' ').filter(|w| !w.is_empty()).collect();
    if words.is_empty() {
        return Ok(SearchResults::default());
    }

    // ---- events, grouped by title and space ----
    let mut s = c.prepare(
        "SELECT e.id, e.title, e.notes, e.location, e.space_id, e.start_at, e.all_day, s.name, IFNULL(a.name, '')
         FROM events e JOIN spaces s ON s.id = e.space_id LEFT JOIN activities a ON a.id = e.activity_id
         WHERE e.deleted_at IS NULL",
    )?;
    let rows = s.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, bool>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, String>(8)?,
        ))
    })?;
    let mut groups: HashMap<(String, String), EventHit> = HashMap::new();
    for row in rows {
        let (id, title, notes, location, space_id, start_at, all_day, space, activity) = row?;
        let t = normalize(&title);
        let hay = format!("{t} {} {} {} {}", normalize(&notes), normalize(&location), normalize(&space), normalize(&activity));
        if !has_all(&hay, &words) {
            continue;
        }
        let in_title = has_all(&t, &words);
        let when = When { event_id: id, start_at: start_at.clone(), all_day };
        let g = groups.entry((t, space_id.clone())).or_insert_with(|| EventHit {
            title: title.clone(),
            space_id,
            location: String::new(),
            count: 0,
            last: None,
            next: None,
            in_title,
        });
        g.count += 1;
        g.in_title |= in_title;
        if start_at.as_str() <= now {
            if g.last.as_ref().is_none_or(|l| start_at > l.start_at) {
                g.last = Some(when);
                if !location.is_empty() {
                    g.location = location;
                }
                g.title = title;
            }
        } else if g.next.as_ref().is_none_or(|n| start_at < n.start_at) {
            g.next = Some(when);
            if !location.is_empty() || g.location.is_empty() {
                g.location = location;
            }
        }
    }
    // Words in the title first; then what is closest to now, coming before past.
    let distance = |h: &EventHit| -> (u8, String) {
        match (&h.next, &h.last) {
            (Some(n), _) => (0, n.start_at.clone()),
            (None, Some(l)) => (1, invert(&l.start_at)),
            _ => (2, String::new()),
        }
    };
    let mut events: Vec<EventHit> = groups.into_values().collect();
    events.sort_by(|a, b| b.in_title.cmp(&a.in_title).then_with(|| distance(a).cmp(&distance(b))).then_with(|| a.title.cmp(&b.title)));
    events.truncate(LIMIT);

    // ---- to-dos ----
    let mut s = c.prepare(
        "SELECT t.id, t.title, t.notes, t.space_id, t.deadline_at, t.completed_at, s.name,
                IFNULL((SELECT group_concat(p.title, ' ') FROM task_parts p WHERE p.task_id = t.id AND p.deleted_at IS NULL), ''),
                t.created_at
         FROM tasks t JOIN spaces s ON s.id = t.space_id
         WHERE t.deleted_at IS NULL",
    )?;
    let rows = s.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, String>(8)?,
        ))
    })?;
    let mut tasks: Vec<(TaskHit, String)> = Vec::new();
    for row in rows {
        let (id, title, notes, space_id, deadline_at, completed_at, space, steps, created) = row?;
        let t = normalize(&title);
        let hay = format!("{t} {} {} {}", normalize(&notes), normalize(&space), normalize(&steps));
        if has_all(&hay, &words) {
            let in_title = has_all(&t, &words);
            tasks.push((TaskHit { id, title, space_id, deadline_at, completed_at, in_title }, created));
        }
    }
    // Words in the title first, open before done, nearest deadline first, then the newest.
    tasks.sort_by(|(a, ca), (b, cb)| {
        b.in_title
            .cmp(&a.in_title)
            .then_with(|| a.completed_at.is_some().cmp(&b.completed_at.is_some()))
            .then_with(|| a.deadline_at.as_deref().unwrap_or("9999").cmp(b.deadline_at.as_deref().unwrap_or("9999")))
            .then_with(|| cb.cmp(ca))
    });
    let tasks = tasks.into_iter().take(LIMIT).map(|(t, _)| t).collect();
    Ok(SearchResults { events, tasks })
}

/// Sorts later moments first when compared as text (ISO times of the same shape).
fn invert(iso: &str) -> String {
    iso.chars().map(|c| c.to_digit(10).map_or(c, |d| char::from_digit(9 - d, 10).unwrap())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn setup() -> Connection {
        let c = open_in_memory().unwrap();
        let ts = "2026-01-01T00:00:00.000Z";
        let ev = |id: &str, title: &str, notes: &str, location: &str, start: &str| {
            c.execute(
                "INSERT INTO events (id, space_id, title, notes, location, start_at, end_at, created_at, updated_at) VALUES (?1, 'seed-space-personal', ?2, ?3, ?4, ?5, ?5, ?6, ?6)",
                rusqlite::params![id, title, notes, location, start, ts],
            )
            .unwrap();
        };
        // A weekly class: two past, two coming.
        ev("w1", "MDI_IT_WEBFW", "Labo", "NOO.05.007", "2026-11-02T09:00:00.000Z");
        ev("w2", "MDI_IT_WEBFW", "Labo", "NOO.05.007", "2026-11-09T09:00:00.000Z");
        ev("w3", "MDI_IT_WEBFW", "Labo", "VIA.01.27", "2026-11-23T09:00:00.000Z");
        ev("w4", "MDI_IT_WEBFW", "Labo", "NOO.05.007", "2026-11-30T09:00:00.000Z");
        ev("d", "Tandarts", "Controle", "", "2025-03-04T13:30:00.000Z");
        ev("x", "Brunch", "with Sam at Café Élise", "", "2026-10-01T10:00:00.000Z");
        c.execute_batch(&format!(
            "INSERT INTO tasks (id, space_id, title, notes, sort_order, created_at, updated_at, completed_at) VALUES
               ('t1', 'seed-space-personal', 'Verslag labo', '', 0, '{ts}', '{ts}', NULL),
               ('t2', 'seed-space-personal', 'Oud verslag', '', 0, '{ts}', '{ts}', '{ts}');
             INSERT INTO task_parts (id, task_id, title, weight, sort_order, created_at, updated_at) VALUES ('p', 't1', 'conclusie schrijven', 1, 0, '{ts}', '{ts}');"
        ))
        .unwrap();
        c
    }
    const NOW: &str = "2026-11-16T08:00:00.000Z";

    #[test]
    fn a_weekly_class_is_one_result_with_its_last_and_next_time() {
        let r = search(&setup(), "webfw", NOW).unwrap();
        assert_eq!(r.events.len(), 1);
        let h = &r.events[0];
        assert_eq!(h.count, 4);
        assert_eq!(h.last.as_ref().unwrap().event_id, "w2");
        assert_eq!(h.next.as_ref().unwrap().event_id, "w3");
        assert_eq!(h.location, "VIA.01.27", "the room of the next one");
    }

    #[test]
    fn finds_long_past_events_in_any_field_without_accents_or_capitals() {
        let c = setup();
        assert_eq!(search(&c, "TANDARTS", NOW).unwrap().events[0].last.as_ref().unwrap().event_id, "d");
        assert_eq!(search(&c, "controle", NOW).unwrap().events[0].title, "Tandarts", "in the notes");
        assert_eq!(search(&c, "elise", NOW).unwrap().events[0].title, "Brunch", "accents do not matter");
        assert_eq!(search(&c, "noo.05", NOW).unwrap().events.len(), 1, "by the room");
        assert!(search(&c, "brunch tandarts", NOW).unwrap().events.is_empty(), "every word must be found");
        assert!(search(&c, "  ", NOW).unwrap().events.is_empty());
    }

    #[test]
    fn todos_also_done_and_by_their_steps() {
        let c = setup();
        let r = search(&c, "verslag", NOW).unwrap();
        assert_eq!(r.tasks.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["t1", "t2"], "open before done");
        assert_eq!(search(&c, "conclusie", NOW).unwrap().tasks[0].id, "t1");
        assert!(!search(&c, "conclusie", NOW).unwrap().tasks[0].in_title);
    }

    #[test]
    fn title_matches_come_first() {
        let c = setup();
        // "labo" is in the notes of the class and in the title of the to-do.
        let r = search(&c, "labo", NOW).unwrap();
        assert!(!r.events[0].in_title);
        assert!(r.tasks[0].in_title);
    }
}
