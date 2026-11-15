//! The next event next to the tray icon: "Chemistry lab in 25 min", or "Shift · 40 min left"
//! while it runs. On macOS this is the text in the menu bar; Windows shows it in the tooltip.
//! It makes time visible without opening Milo, and stays empty when nothing is coming up soon.

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::Connection;

use crate::error::Result;
use crate::repo;

/// Further ahead than this, nothing shows: a countdown of many hours is only noise.
pub const HORIZON_MINUTES: i64 = 180;
/// While an event runs, the next one takes over this long before it starts, to help the switch.
pub const HANDOVER_MINUTES: i64 = 15;
/// Longer titles are cut, so the menu bar stays tidy.
const MAX_TITLE: usize = 24;
/// Settings key; "off" hides the text.
pub const SETTING: &str = "menubar_next";

#[derive(Debug, Clone, PartialEq)]
pub struct Slot {
    pub title: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

pub fn enabled(c: &Connection) -> Result<bool> {
    Ok(repo::get_setting(c, SETTING)?.as_deref() != Some("off"))
}

pub fn set_enabled(c: &Connection, on: bool) -> Result<()> {
    repo::set_setting(c, SETTING, Some(if on { "on" } else { "off" }))
}

fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// The event running now and the first one after it, within the horizon. Leaves out all-day
/// events, events marked as not happening, focus sessions and sleep.
fn upcoming(c: &Connection, now: DateTime<Utc>) -> Result<Vec<Slot>> {
    let mut s = c.prepare(
        "SELECT e.title, e.start_at, e.end_at FROM events e JOIN spaces s ON s.id = e.space_id
         WHERE e.deleted_at IS NULL AND e.all_day = 0 AND e.status != 'skipped' AND e.source != 'focus'
           AND s.role != 'sleep' AND e.end_at > ?1 AND e.start_at < ?2
         ORDER BY e.start_at, e.end_at LIMIT 8",
    )?;
    let rows = s
        .query_map([iso(now), iso(now + Duration::minutes(HORIZON_MINUTES))], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(title, a, b)| {
            Some(Slot {
                title,
                start: DateTime::parse_from_rfc3339(&a).ok()?.with_timezone(&Utc),
                end: DateTime::parse_from_rfc3339(&b).ok()?.with_timezone(&Utc),
            })
        })
        .collect())
}

/// What to show: the event running now, unless the next one starts within the handover time;
/// else the next one.
pub fn pick(slots: &[Slot], now: DateTime<Utc>) -> Option<&Slot> {
    let running = slots.iter().filter(|s| s.start <= now).max_by_key(|s| s.start);
    let next = slots.iter().find(|s| s.start > now);
    match (running, next) {
        (Some(_), Some(n)) if n.start - now <= Duration::minutes(HANDOVER_MINUTES) => Some(n),
        (Some(r), _) => Some(r),
        (None, n) => n,
    }
}

/// "25 min", "1 h 10", "2 h".
fn span(d: Duration) -> String {
    let m = ((d.num_seconds() + 59) / 60).max(1);
    match (m / 60, m % 60) {
        (0, m) => format!("{m} min"),
        (h, 0) => format!("{h} h"),
        (h, m) => format!("{h} h {m:02}"),
    }
}

fn short(title: &str) -> String {
    let t = title.trim();
    let t = if t.is_empty() { "Untitled" } else { t };
    if t.chars().count() <= MAX_TITLE {
        t.to_string()
    } else {
        // Cut at a word where one is near, so no half words show.
        let cut: String = t.chars().take(MAX_TITLE - 1).collect();
        let cut = match cut.rfind(' ') {
            Some(i) if i >= MAX_TITLE / 2 => &cut[..i],
            _ => &cut[..],
        };
        format!("{}…", cut.trim_end())
    }
}

/// The text for one event, as seen at `now`.
pub fn label(slot: &Slot, now: DateTime<Utc>) -> String {
    let title = short(&slot.title);
    if slot.start > now {
        if slot.start - now < Duration::seconds(60) {
            format!("{title} now")
        } else {
            format!("{title} in {}", span(slot.start - now))
        }
    } else {
        format!("{title} · {} left", span(slot.end - now))
    }
}

/// The text next to the tray icon now, or None for just the icon.
pub fn text(c: &Connection, now: DateTime<Utc>) -> Result<Option<String>> {
    if !enabled(c)? {
        return Ok(None);
    }
    let slots = upcoming(c, now)?;
    Ok(pick(&slots, now).map(|s| label(s, now)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::models::EventInput;
    use chrono::TimeZone;

    fn t(h: u32, m: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 16, h, m, 0).unwrap()
    }

    fn slot(title: &str, a: DateTime<Utc>, b: DateTime<Utc>) -> Slot {
        Slot { title: title.into(), start: a, end: b }
    }

    fn add(c: &Connection, space: &str, title: &str, a: DateTime<Utc>, b: DateTime<Utc>, all_day: bool) {
        repo::create_event(
            c,
            EventInput {
                space_id: space.into(),
                activity_id: None,
                title: title.into(),
                start_at: iso(a),
                end_at: iso(b),
                all_day,
                notes: String::new(),
                status: "planned".into(),
                task_id: None,
            },
            "milo",
        )
        .unwrap();
    }

    #[test]
    fn counts_down_to_the_next_event() {
        let s = slot("Chemistry lab", t(13, 0), t(15, 0));
        assert_eq!(label(&s, t(12, 35)), "Chemistry lab in 25 min");
        assert_eq!(label(&s, t(11, 50)), "Chemistry lab in 1 h 10");
        assert_eq!(label(&s, t(11, 0)), "Chemistry lab in 2 h");
        assert_eq!(label(&s, t(12, 59) + Duration::seconds(30)), "Chemistry lab now");
        // Partial minutes round up: 24 min 30 s is still "25 min".
        assert_eq!(label(&s, t(12, 35) + Duration::seconds(30)), "Chemistry lab in 25 min");
    }

    #[test]
    fn shows_the_time_left_while_it_runs() {
        let s = slot("Shift", t(17, 0), t(21, 0));
        assert_eq!(label(&s, t(20, 20)), "Shift · 40 min left");
        assert_eq!(label(&s, t(17, 30)), "Shift · 3 h 30 left");
    }

    #[test]
    fn cuts_long_titles() {
        let s = slot("Physics problems session with the whole group", t(13, 0), t(14, 0));
        let l = label(&s, t(12, 0));
        assert_eq!(l, "Physics problems… in 1 h");
        assert_eq!(label(&slot("  ", t(13, 0), t(14, 0)), t(12, 0)), "Untitled in 1 h");
    }

    #[test]
    fn the_next_event_takes_over_just_before_it_starts() {
        let lesson = slot("Lesson", t(9, 0), t(12, 0));
        let lab = slot("Lab", t(12, 0), t(14, 0));
        let both = [lesson.clone(), lab.clone()];
        assert_eq!(pick(&both, t(10, 0)), Some(&lesson));
        assert_eq!(pick(&both, t(11, 50)), Some(&lab));
        assert_eq!(pick(&both[1..], t(8, 0)), Some(&lab));
        assert_eq!(pick(&[], t(8, 0)), None);
    }

    #[test]
    fn reads_the_calendar_and_leaves_out_what_does_not_count() {
        let c = open_in_memory().unwrap();
        let now = t(12, 0);
        add(&c, "seed-space-personal", "Brunch", t(12, 30), t(13, 30), false);
        add(&c, "seed-space-personal", "Holiday", t(0, 0), t(23, 0), true);
        add(&c, "seed-space-sleep", "Sleep", t(11, 0), t(13, 0), false);
        add(&c, "seed-space-personal", "Far away", t(18, 0), t(19, 0), false);
        assert_eq!(text(&c, now).unwrap().as_deref(), Some("Brunch in 30 min"));

        // Nothing within the horizon: only the icon.
        assert_eq!(text(&c, t(14, 0)).unwrap(), None);

        set_enabled(&c, false).unwrap();
        assert!(!enabled(&c).unwrap());
        assert_eq!(text(&c, now).unwrap(), None);
        set_enabled(&c, true).unwrap();
        assert!(enabled(&c).unwrap());
    }
}
