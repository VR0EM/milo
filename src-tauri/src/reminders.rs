//! Decides which reminders are due. Pure database + clock logic, no Tauri, so it is testable.
//! The caller (a background thread) asks every 30 seconds and shows what comes back.
//!
//! Decision: a reminder fires only within GRACE_MINUTES of its moment. After the laptop
//! wakes from sleep, old reminders are skipped instead of arriving all at once.

use crate::db::{new_id, now};
use crate::error::Result;
use crate::models::Confirmation;
use crate::repo;
use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};

const GRACE_MINUTES: i64 = 5;
/// A reminder that asks to be confirmed is repeated once, this long after, if still open.
const CONFIRM_AGAIN_MINUTES: i64 = 30;

fn confirmed(c: &Connection, rule_id: &str, occurrence: &str) -> Result<bool> {
    Ok(c.query_row(
        "SELECT COUNT(*) FROM reminder_log WHERE rule_id = ?1 AND occurrence = ?2 AND confirmed_at IS NOT NULL",
        params![rule_id, occurrence],
        |r| r.get::<_, i64>(0),
    )? > 0)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Due {
    pub rule_id: String,
    pub occurrence: String,
    pub title: String,
    pub body: String,
}

fn iso(t: DateTime<Local>) -> String {
    t.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn parse_time(t: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(t, "%H:%M").ok()
}

/// True when the wall-clock time `t` today lies in (now - grace, now].
fn just_passed(now: DateTime<Local>, t: NaiveTime) -> bool {
    let n = now.time();
    let diff = n.signed_duration_since(t);
    diff >= Duration::zero() && diff < Duration::minutes(GRACE_MINUTES)
}

pub fn collect_due(c: &Connection, now: DateTime<Local>) -> Result<Vec<Due>> {
    let mut due = Vec::new();
    let weekday = now.weekday().number_from_monday().to_string();
    let date = now.format("%Y-%m-%d").to_string();

    for rule in repo::list_reminder_rules(c)?.into_iter().filter(|r| r.enabled) {
        match rule.kind.as_str() {
            "event" => {
                let before = Duration::minutes(rule.minutes_before.unwrap_or(10));
                let from = iso(now + before - Duration::minutes(GRACE_MINUTES));
                let to = iso(now + before);
                let mut s = c.prepare(
                    "SELECT id, title, start_at FROM events
                     WHERE deleted_at IS NULL AND status != 'skipped' AND all_day = 0 AND source != 'focus'
                       AND start_at > ?1 AND start_at <= ?2",
                )?;
                let rows = s
                    .query_map([&from, &to], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                for (id, title, start_at) in rows {
                    let start = DateTime::parse_from_rfc3339(&start_at).map(|d| d.with_timezone(&Local).format("%H:%M").to_string());
                    due.push(Due {
                        rule_id: rule.id.clone(),
                        occurrence: format!("{id}@{start_at}"),
                        title: if title.is_empty() { "Event".into() } else { title },
                        body: start.map(|t| format!("Starts at {t}")).unwrap_or_default(),
                    });
                }
            }
            "times" if rule.weekdays.contains(&weekday) => {
                for t in rule.times.as_deref().unwrap_or("").split(',') {
                    let Some(nt) = parse_time(t) else { continue };
                    let occurrence = format!("{date}T{t}");
                    if just_passed(now, nt) {
                        let body = if rule.ask_confirm { format!("{t} · mark it as done on Today in Milo") } else { t.to_string() };
                        due.push(Due { rule_id: rule.id.clone(), occurrence: occurrence.clone(), title: rule.title.clone(), body });
                    }
                    let again = nt + Duration::minutes(CONFIRM_AGAIN_MINUTES);
                    if rule.ask_confirm && again > nt && just_passed(now, again) && !confirmed(c, &rule.id, &occurrence)? {
                        due.push(Due {
                            rule_id: rule.id.clone(),
                            occurrence: format!("{occurrence}|again"),
                            title: rule.title.clone(),
                            body: format!("Still open from {t} · mark it as done on Today in Milo"),
                        });
                    }
                }
            }
            "focus" => {
                if let Some(s) = repo::active_focus(c)? {
                    let started = DateTime::parse_from_rfc3339(&s.started_at).map(|d| d.with_timezone(&Local));
                    if let Ok(started) = started {
                        if now >= started + Duration::minutes(s.planned_minutes) {
                            let what = if s.title.is_empty() { String::new() } else { format!(" on {}", s.title) };
                            due.push(Due {
                                rule_id: rule.id.clone(),
                                occurrence: format!("focus:{}", s.id),
                                title: "Focus session done".into(),
                                body: format!("{} minutes{what}. Stop and save when you are ready.", s.planned_minutes),
                            });
                        }
                    }
                }
            }
            "interval" if rule.weekdays.contains(&weekday) => {
                let (Some(start), Some(end), Some(step)) = (
                    rule.start_time.as_deref().and_then(parse_time),
                    rule.end_time.as_deref().and_then(parse_time),
                    rule.interval_minutes.filter(|m| *m > 0),
                ) else {
                    continue;
                };
                let mut slot = start;
                while slot <= end {
                    if just_passed(now, slot) {
                        let t = slot.format("%H:%M").to_string();
                        due.push(Due { rule_id: rule.id.clone(), occurrence: format!("{date}T{t}"), title: rule.title.clone(), body: t });
                    }
                    let (next, wrapped) = slot.overflowing_add_signed(Duration::minutes(step));
                    if wrapped != 0 {
                        break;
                    }
                    slot = next;
                }
            }
            _ => {}
        }
    }
    Ok(due)
}

/// Today's moments that ask to be confirmed, with whether they were.
pub fn confirmations(c: &Connection, now: DateTime<Local>) -> Result<Vec<Confirmation>> {
    let weekday = now.weekday().number_from_monday().to_string();
    let date = now.format("%Y-%m-%d").to_string();
    let mut out = Vec::new();
    for rule in repo::list_reminder_rules(c)? {
        if !(rule.enabled && rule.ask_confirm && rule.kind == "times" && rule.weekdays.contains(&weekday)) {
            continue;
        }
        for t in rule.times.as_deref().unwrap_or("").split(',').filter(|t| parse_time(t).is_some()) {
            let occurrence = format!("{date}T{t}");
            let confirmed_at = c
                .query_row(
                    "SELECT confirmed_at FROM reminder_log WHERE rule_id = ?1 AND occurrence = ?2",
                    params![rule.id, occurrence],
                    |r| r.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten();
            out.push(Confirmation { rule_id: rule.id.clone(), title: rule.title.clone(), time: t.to_string(), occurrence, confirmed_at });
        }
    }
    out.sort_by(|a, b| a.time.cmp(&b.time));
    Ok(out)
}

/// Marks a moment as done, or undoes that. Confirming before the moment means no reminder fires.
pub fn set_confirmed(c: &Connection, rule_id: &str, occurrence: &str, done: bool) -> Result<()> {
    let ts = now();
    c.execute(
        "INSERT OR IGNORE INTO reminder_log (id, rule_id, occurrence, fired_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)",
        params![new_id(), rule_id, occurrence, ts],
    )?;
    let value = if done { Some(ts.as_str()) } else { None };
    c.execute(
        "UPDATE reminder_log SET confirmed_at = ?3, updated_at = ?4 WHERE rule_id = ?1 AND occurrence = ?2",
        params![rule_id, occurrence, value, ts],
    )?;
    Ok(())
}

/// Everything that should be shown now. Each occurrence is returned exactly once, ever.
pub fn tick(c: &Connection, at: DateTime<Local>) -> Result<Vec<Due>> {
    let mut fresh = Vec::new();
    for d in collect_due(c, at)? {
        let ts = now();
        let inserted = c.execute(
            "INSERT OR IGNORE INTO reminder_log (id, rule_id, occurrence, fired_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)",
            params![new_id(), d.rule_id, d.occurrence, ts],
        )?;
        if inserted == 1 {
            fresh.push(d);
        }
    }
    Ok(fresh)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::models::EventInput;
    use chrono::TimeZone;

    fn at(h: u32, m: u32) -> DateTime<Local> {
        // 2026-11-11 is a Wednesday.
        Local.with_ymd_and_hms(2026, 11, 11, h, m, 30).unwrap()
    }

    fn enable(c: &Connection, id: &str) {
        c.execute("UPDATE reminder_rules SET enabled = 1 WHERE id = ?1", [id]).unwrap();
    }

    #[test]
    fn event_reminder_fires_once_before_the_start() {
        let c = open_in_memory().unwrap();
        let start = at(14, 0) - Duration::seconds(30);
        repo::create_event(
            &c,
            EventInput {
                space_id: "seed-space-personal".into(),
                activity_id: None,
                title: "Analysis".into(),
                start_at: iso(start),
                end_at: iso(start + Duration::hours(1)),
                all_day: false,
                notes: String::new(),
                status: "planned".into(),
            },
            "manual",
        )
        .unwrap();

        assert!(tick(&c, at(13, 40)).unwrap().is_empty(), "too early");
        let due = tick(&c, at(13, 50)).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!((due[0].title.as_str(), due[0].body.as_str()), ("Analysis", "Starts at 14:00"));
        assert!(tick(&c, at(13, 51)).unwrap().is_empty(), "never twice");
    }

    #[test]
    fn confirm_and_focus() {
        let c = open_in_memory().unwrap();
        enable(&c, "seed-reminder-medication"); // 08:00, asks to confirm
        let list = confirmations(&c, at(7, 0)).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].confirmed_at.is_none());

        let first = tick(&c, at(8, 1)).unwrap();
        assert_eq!(first.len(), 1);
        assert!(first[0].body.contains("Today"));
        // Not confirmed: one gentle repeat 30 minutes later, then nothing.
        assert_eq!(tick(&c, at(8, 31)).unwrap().len(), 1);
        assert!(tick(&c, at(9, 2)).unwrap().is_empty());

        set_confirmed(&c, "seed-reminder-medication", &list[0].occurrence, true).unwrap();
        assert!(confirmations(&c, at(9, 0)).unwrap()[0].confirmed_at.is_some());
        set_confirmed(&c, "seed-reminder-medication", &list[0].occurrence, false).unwrap();
        assert!(confirmations(&c, at(9, 0)).unwrap()[0].confirmed_at.is_none());

        // Confirmed before the moment: no reminder, no repeat (the next day, 2026-11-12).
        let next = Local.with_ymd_and_hms(2026, 11, 12, 7, 30, 0).unwrap();
        let occ = confirmations(&c, next).unwrap()[0].occurrence.clone();
        set_confirmed(&c, "seed-reminder-medication", &occ, true).unwrap();
        assert!(tick(&c, Local.with_ymd_and_hms(2026, 11, 12, 8, 1, 0).unwrap()).unwrap().is_empty());
        assert!(tick(&c, Local.with_ymd_and_hms(2026, 11, 12, 8, 31, 0).unwrap()).unwrap().is_empty());

        // A focus session that reached its length is announced once.
        let s = repo::start_focus(&c, crate::models::FocusInput { space_id: "seed-space-personal".into(), activity_id: None, task_id: None, title: "Essay".into(), planned_minutes: 25 }).unwrap();
        assert!(tick(&c, Local::now()).unwrap().iter().all(|d| !d.title.starts_with("Focus")), "not yet");
        c.execute("UPDATE focus_sessions SET started_at = '2020-01-01T10:00:00.000Z' WHERE id = ?1", [&s.id]).unwrap();
        let done: Vec<_> = tick(&c, Local::now()).unwrap().into_iter().filter(|d| d.title.starts_with("Focus")).collect();
        assert_eq!(done.len(), 1);
        assert!(done[0].body.contains("on Essay"));
        assert!(tick(&c, Local::now()).unwrap().iter().all(|d| !d.title.starts_with("Focus")), "only once");
    }

    #[test]
    fn fixed_times_and_intervals() {
        let c = open_in_memory().unwrap();
        assert!(tick(&c, at(8, 0)).unwrap().is_empty(), "medication is off by default");
        enable(&c, "seed-reminder-medication");
        enable(&c, "seed-reminder-water");
        // This test is about plain reminders; the confirm repeat has its own test.
        c.execute("UPDATE reminder_rules SET ask_confirm = 0", []).unwrap();

        let due = tick(&c, at(8, 2)).unwrap();
        assert_eq!(due.iter().map(|d| d.title.as_str()).collect::<Vec<_>>(), vec!["Medication"]);
        assert!(tick(&c, at(8, 3)).unwrap().is_empty());
        assert!(tick(&c, at(8, 30)).unwrap().is_empty(), "missed moments are not replayed later");

        // water: every 90 minutes from 09:00 to 21:00 -> 09:00, 10:30, 12:00 ...
        assert_eq!(tick(&c, at(10, 31)).unwrap().len(), 1);
        assert!(tick(&c, at(11, 0)).unwrap().is_empty());
        assert_eq!(tick(&c, at(21, 0)).unwrap().len(), 1);
        assert!(tick(&c, at(22, 30)).unwrap().is_empty(), "nothing after the end time");

        // a rule limited to weekends stays quiet on a Wednesday
        c.execute("UPDATE reminder_rules SET weekdays = '67'", []).unwrap();
        assert!(tick(&c, at(12, 0)).unwrap().is_empty());
    }
}
