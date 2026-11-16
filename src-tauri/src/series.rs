//! Repeating events made in Milo ("every Monday", "every 2 weeks on Tue and Thu").
//!
//! Every occurrence is written as an ordinary event row with `series_id`, so reminders,
//! Insights, the calendar and the archive need nothing special. A series without an end keeps
//! `HORIZON_DAYS` of occurrences ahead; `extend` tops that up as time passes.
//!
//! Changing the repeat of an occurrence changes "this and the following ones": the old
//! series ends there, its future occurrences are set aside (`replaced`, never deleted), and a
//! new series starts from this event with its current details. Past occurrences are history
//! and are never touched.

use crate::db::{new_id, now};
use crate::error::{AppError, Result};
use crate::models::{Event, EventSeries, RepeatRule};
use crate::repo;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveTime, TimeZone, Timelike, Utc};
use rusqlite::{params, Connection, OptionalExtension};

/// How far ahead occurrences of a series without an end are written.
pub const HORIZON_DAYS: i64 = 180;
/// A series with an end date is written out at most this far.
const MAX_DAYS: i64 = 3 * 366;

fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn parse_utc(s: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|t| t.with_timezone(&Utc))
        .map_err(|_| AppError::Invalid(format!("Not a time: {s}")))
}

fn parse_date(s: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| AppError::Invalid(format!("Not a date: {s}")))
}

/// A wall-clock moment on the computer's clock, as UTC. In the hour a clock jumps forward the
/// first valid moment after it is used.
fn local_to_utc(date: NaiveDate, time: NaiveTime) -> DateTime<Utc> {
    let naive = date.and_time(time);
    match Local.from_local_datetime(&naive).earliest() {
        Some(t) => t.with_timezone(&Utc),
        None => Local.from_local_datetime(&(naive + Duration::hours(1))).earliest().map(|t| t.with_timezone(&Utc)).unwrap_or_else(|| Utc.from_utc_datetime(&naive)),
    }
}

fn check_rule(rule: &RepeatRule) -> Result<()> {
    if !["daily", "weekly", "monthly"].contains(&rule.freq.as_str()) {
        return Err(AppError::Invalid(format!("Unknown repeat: {}", rule.freq)));
    }
    if !(1..=99).contains(&rule.interval) {
        return Err(AppError::Invalid("Repeat every 1 to 99".into()));
    }
    if !rule.weekdays.chars().all(|c| ('1'..='7').contains(&c)) {
        return Err(AppError::Invalid("Weekdays are 1 (Monday) to 7 (Sunday)".into()));
    }
    if let Some(u) = &rule.until_date {
        parse_date(u)?;
    }
    Ok(())
}

/// Template of a series: what each occurrence looks like.
struct Series {
    id: String,
    rule: RepeatRule,
    first: NaiveDate,
    start_time: NaiveTime,
    minutes: i64,
    all_day: bool,
    space_id: String,
    activity_id: Option<String>,
    title: String,
    notes: String,
    location: String,
    reminders: Option<String>,
    generated_until: NaiveDate,
}

impl Series {
    /// Whether an occurrence falls on `d`.
    fn on(&self, d: NaiveDate) -> bool {
        if d < self.first {
            return false;
        }
        let n = self.rule.interval;
        match self.rule.freq.as_str() {
            "daily" => (d - self.first).num_days() % n == 0,
            "weekly" => {
                let days: Vec<u32> = if self.rule.weekdays.is_empty() {
                    vec![self.first.weekday().number_from_monday()]
                } else {
                    self.rule.weekdays.chars().filter_map(|c| c.to_digit(10)).collect()
                };
                let week0 = self.first - Duration::days(self.first.weekday().num_days_from_monday() as i64);
                days.contains(&d.weekday().number_from_monday()) && ((d - week0).num_days() / 7) % n == 0
            }
            _ => {
                let months = (d.year() - self.first.year()) as i64 * 12 + d.month() as i64 - self.first.month() as i64;
                d.day() == self.first.day() && months % n == 0
            }
        }
    }

    fn times(&self, d: NaiveDate) -> (DateTime<Utc>, DateTime<Utc>) {
        if self.all_day {
            let days = (self.minutes / 1440).max(1);
            (local_to_utc(d, NaiveTime::MIN), local_to_utc(d + Duration::days(days), NaiveTime::MIN))
        } else {
            let start = local_to_utc(d, self.start_time);
            (start, start + Duration::minutes(self.minutes))
        }
    }

    /// The last day occurrences are written for, seen from `today`.
    fn target(&self, today: NaiveDate) -> NaiveDate {
        let cap = match &self.rule.until_date {
            Some(u) => parse_date(u).unwrap_or(today).min(self.first + Duration::days(MAX_DAYS)),
            None => today + Duration::days(HORIZON_DAYS),
        };
        cap.max(self.first)
    }

    /// Writes occurrences on days in (after, to] that start later than `cut`.
    fn write(&self, c: &Connection, after: NaiveDate, to: NaiveDate, cut: &str) -> Result<usize> {
        let ts = now();
        let mut n = 0;
        let mut d = after + Duration::days(1);
        while d <= to {
            if self.on(d) {
                let (start, end) = self.times(d);
                let start = iso(start);
                if start.as_str() > cut {
                    c.execute(
                        "INSERT INTO events (id, space_id, activity_id, title, start_at, end_at, all_day, notes, location, reminders, status, source, series_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?12, 'planned', 'manual', ?10, ?11, ?11)",
                        params![new_id(), self.space_id, self.activity_id, self.title, start, iso(end), self.all_day, self.notes, self.location, self.id, ts, self.reminders],
                    )?;
                    n += 1;
                }
            }
            d += Duration::days(1);
        }
        Ok(n)
    }
}

fn load(c: &Connection, id: &str) -> Result<Option<Series>> {
    let row = c
        .query_row(
            "SELECT id, freq, interval, weekdays, first_date, until_date, start_time, minutes, all_day, space_id, activity_id, title, notes, generated_until, location, reminders
             FROM event_series WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    RepeatRule { freq: r.get(1)?, interval: r.get(2)?, weekdays: r.get(3)?, until_date: r.get(5)? },
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, bool>(8)?,
                    r.get::<_, String>(9)?,
                    r.get::<_, Option<String>>(10)?,
                    r.get::<_, String>(11)?,
                    r.get::<_, String>(12)?,
                    r.get::<_, String>(13)?,
                    r.get::<_, String>(14)?,
                    r.get::<_, Option<String>>(15)?,
                ))
            },
        )
        .optional()?;
    let Some((id, rule, first, start_time, minutes, all_day, space_id, activity_id, title, notes, generated, location, reminders)) = row else {
        return Ok(None);
    };
    Ok(Some(Series {
        id,
        rule,
        first: parse_date(&first)?,
        start_time: NaiveTime::parse_from_str(&start_time, "%H:%M").unwrap_or(NaiveTime::MIN),
        minutes,
        all_day,
        space_id,
        activity_id,
        title,
        notes,
        location,
        reminders,
        generated_until: parse_date(&generated)?,
    }))
}

pub fn list(c: &Connection) -> Result<Vec<EventSeries>> {
    let mut s = c.prepare(
        "SELECT id, freq, interval, weekdays, until_date, first_date FROM event_series WHERE deleted_at IS NULL",
    )?;
    let rows = s
        .query_map([], |r| {
            Ok(EventSeries {
                id: r.get(0)?,
                rule: RepeatRule { freq: r.get(1)?, interval: r.get(2)?, weekdays: r.get(3)?, until_date: r.get(4)? },
                first_date: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Sets aside the occurrences of `series` that start after `cut` (except `keep`), and ends the
/// series on the local day of `cut`.
fn end_series(c: &Connection, series: &str, cut: &str, keep: &str) -> Result<()> {
    let ts = now();
    // Generated occurrences nobody touched never were anyone's data: they go for real, so
    // changing a repeat does not leave hundreds of unused rows behind. One that was edited,
    // has earlier versions or holds a focus session is set aside instead, as always.
    c.execute(
        "DELETE FROM events
         WHERE series_id = ?1 AND deleted_at IS NULL AND start_at > ?2 AND id != ?3
           AND updated_at = created_at
           AND NOT EXISTS (SELECT 1 FROM change_log WHERE entity = 'event' AND entity_id = events.id)
           AND NOT EXISTS (SELECT 1 FROM focus_sessions WHERE event_id = events.id)",
        params![series, cut, keep],
    )?;
    c.execute(
        "UPDATE events SET deleted_at = ?3, replaced = 1, updated_at = ?3
         WHERE series_id = ?1 AND deleted_at IS NULL AND start_at > ?2 AND id != ?4",
        params![series, cut, ts, keep],
    )?;
    let last = parse_utc(cut)?.with_timezone(&Local).date_naive().format("%Y-%m-%d").to_string();
    c.execute(
        "UPDATE event_series SET until_date = ?2, generated_until = MAX(generated_until, ?2), updated_at = ?3 WHERE id = ?1",
        params![series, last, ts],
    )?;
    Ok(())
}

/// Makes `event` repeat by `rule` from now on ("this and the following ones"), or stops the
/// repeat after it when `rule` is None (the event itself then stands on its own). Imported events repeat in their own calendar.
pub fn set_repeat(c: &Connection, event_id: &str, rule: Option<RepeatRule>, now_utc: DateTime<Utc>) -> Result<Event> {
    let event = repo::get_event(c, event_id)?;
    if event.source == "import" {
        return Err(AppError::Invalid("Imported events repeat in the calendar they come from".into()));
    }
    let now_s = iso(now_utc);
    // Only the future changes; past occurrences stay as they happened.
    let cut = if event.start_at > now_s { event.start_at.clone() } else { now_s };
    if let Some(old) = &event.series_id {
        end_series(c, old, &cut, &event.id)?;
    }
    let Some(rule) = rule else {
        // This event no longer repeats; the ones before it keep their series.
        c.execute("UPDATE events SET series_id = NULL, updated_at = ?2 WHERE id = ?1", params![event.id, now()])?;
        return repo::get_event(c, event_id);
    };
    check_rule(&rule)?;

    let start = parse_utc(&event.start_at)?.with_timezone(&Local);
    let end = parse_utc(&event.end_at)?.with_timezone(&Local);
    let first = start.date_naive();
    if let Some(u) = &rule.until_date {
        if parse_date(u)? < first {
            return Err(AppError::Invalid("The repeat cannot end before the event".into()));
        }
    }
    let series = Series {
        id: new_id(),
        rule,
        first,
        start_time: NaiveTime::from_hms_opt(start.hour(), start.minute(), 0).unwrap_or(NaiveTime::MIN),
        minutes: (end - start).num_minutes().max(1),
        all_day: event.all_day,
        space_id: event.space_id.clone(),
        activity_id: event.activity_id.clone(),
        title: event.title.clone(),
        notes: event.notes.clone(),
        location: event.location.clone(),
        reminders: event.reminders.clone(),
        generated_until: first,
    };
    let today = now_utc.with_timezone(&Local).date_naive();
    let target = series.target(today);
    let ts = now();
    c.execute(
        "INSERT INTO event_series (id, freq, interval, weekdays, first_date, until_date, start_time, minutes, all_day,
           space_id, activity_id, title, notes, generated_until, location, reminders, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?16, ?17, ?15, ?15)",
        params![
            series.id,
            series.rule.freq,
            series.rule.interval,
            series.rule.weekdays,
            first.format("%Y-%m-%d").to_string(),
            series.rule.until_date,
            series.start_time.format("%H:%M").to_string(),
            series.minutes,
            series.all_day,
            series.space_id,
            series.activity_id,
            series.title,
            series.notes,
            target.format("%Y-%m-%d").to_string(),
            ts,
            series.location,
            series.reminders
        ],
    )?;
    c.execute("UPDATE events SET series_id = ?2, updated_at = ?3 WHERE id = ?1", params![event.id, series.id, ts])?;
    series.write(c, first, target, &cut)?;
    repo::get_event(c, event_id)
}

/// Writes occurrences for series that reach past what exists so far. Cheap when nothing is due.
pub fn extend(c: &Connection, now_utc: DateTime<Utc>) -> Result<usize> {
    let today = now_utc.with_timezone(&Local).date_naive();
    let ids: Vec<String> = c
        .prepare("SELECT id FROM event_series WHERE deleted_at IS NULL")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut n = 0;
    for id in ids {
        let Some(s) = load(c, &id)? else { continue };
        let target = s.target(today);
        if target <= s.generated_until {
            continue;
        }
        n += s.write(c, s.generated_until, target, &iso(now_utc))?;
        c.execute(
            "UPDATE event_series SET generated_until = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, target.format("%Y-%m-%d").to_string(), now()],
        )?;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::models::EventInput;

    fn event_at(c: &Connection, start: DateTime<Local>, minutes: i64) -> Event {
        repo::create_event(
            c,
            EventInput {
                space_id: "seed-space-personal".into(),
                activity_id: None,
                title: "Sport".into(),
                start_at: iso(start.with_timezone(&Utc)),
                end_at: iso((start + Duration::minutes(minutes)).with_timezone(&Utc)),
                all_day: false,
                notes: String::new(),
                status: "planned".into(),
                task_id: None, location: String::new(), reminders: None },
            "manual",
        )
        .unwrap()
    }

    fn occurrences(c: &Connection, series: &str) -> Vec<DateTime<Local>> {
        let mut s = c.prepare("SELECT start_at FROM events WHERE series_id = ?1 AND deleted_at IS NULL ORDER BY start_at").unwrap();
        s.query_map([series], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|x| parse_utc(&x.unwrap()).unwrap().with_timezone(&Local))
            .collect()
    }

    fn rule(freq: &str, interval: i64, weekdays: &str, until: Option<&str>) -> RepeatRule {
        RepeatRule { freq: freq.into(), interval, weekdays: weekdays.into(), until_date: until.map(Into::into) }
    }

    #[test]
    fn weekly_on_two_days_until_a_date() {
        let c = open_in_memory().unwrap();
        // Monday 2 March 2026, 18:00 local, seen from the Sunday before.
        let start = Local.with_ymd_and_hms(2026, 3, 2, 18, 0, 0).unwrap();
        let now = (start - Duration::days(1)).with_timezone(&Utc);
        let e = event_at(&c, start, 60);
        let e = set_repeat(&c, &e.id, Some(rule("weekly", 1, "13", Some("2026-03-15"))), now).unwrap();
        let all = occurrences(&c, e.series_id.as_deref().unwrap());
        let days: Vec<_> = all.iter().map(|t| t.format("%a %d %H:%M").to_string()).collect();
        assert_eq!(days, ["Mon 02 18:00", "Wed 04 18:00", "Mon 09 18:00", "Wed 11 18:00"]);
    }

    #[test]
    fn every_two_weeks_and_monthly() {
        let c = open_in_memory().unwrap();
        let start = Local.with_ymd_and_hms(2026, 1, 31, 9, 0, 0).unwrap();
        let now = (start - Duration::hours(1)).with_timezone(&Utc);
        let m = event_at(&c, start, 30);
        let m = set_repeat(&c, &m.id, Some(rule("monthly", 1, "", Some("2026-06-30"))), now).unwrap();
        let months: Vec<_> = occurrences(&c, m.series_id.as_deref().unwrap()).iter().map(|t| t.format("%m-%d").to_string()).collect();
        // Months without a 31st are skipped.
        assert_eq!(months, ["01-31", "03-31", "05-31"]);

        let start = Local.with_ymd_and_hms(2026, 4, 7, 9, 0, 0).unwrap(); // a Tuesday
        let w = event_at(&c, start, 30);
        let w = set_repeat(&c, &w.id, Some(rule("weekly", 2, "", Some("2026-05-10"))), now).unwrap();
        let weeks: Vec<_> = occurrences(&c, w.series_id.as_deref().unwrap()).iter().map(|t| t.format("%m-%d").to_string()).collect();
        assert_eq!(weeks, ["04-07", "04-21", "05-05"]);
    }

    #[test]
    fn changing_keeps_the_past_and_replaces_the_future() {
        let c = open_in_memory().unwrap();
        let start = Local.with_ymd_and_hms(2026, 3, 2, 18, 0, 0).unwrap();
        let e = event_at(&c, start, 60);
        let early = (start - Duration::days(1)).with_timezone(&Utc);
        let e = set_repeat(&c, &e.id, Some(rule("daily", 1, "", None)), early).unwrap();
        let first_series = e.series_id.clone().unwrap();
        assert_eq!(occurrences(&c, &first_series).len() as i64, HORIZON_DAYS - 1 + 1);

        // Three days later, the occurrence of 5 March gets a new repeat: weekly.
        let later = (start + Duration::days(3) - Duration::hours(2)).with_timezone(&Utc);
        let fifth: String = c
            .query_row("SELECT id FROM events WHERE series_id = ?1 ORDER BY start_at LIMIT 1 OFFSET 3", [&first_series], |r| r.get(0))
            .unwrap();
        let moved = set_repeat(&c, &fifth, Some(rule("weekly", 1, "", None)), later).unwrap();
        // The old series keeps 2, 3, 4 March (and nothing after), the new one starts on the 5th.
        assert_eq!(occurrences(&c, &first_series).len(), 3);
        let new_series = moved.series_id.unwrap();
        let next: Vec<_> = occurrences(&c, &new_series).iter().take(3).map(|t| t.format("%m-%d").to_string()).collect();
        assert_eq!(next, ["03-05", "03-12", "03-19"]);
        // Untouched future occurrences of the old repeat are gone, not piled up.
        let left: i64 = c.query_row("SELECT COUNT(*) FROM events WHERE series_id = ?1", [&first_series], |r| r.get(0)).unwrap();
        assert_eq!(left, 3);
        let (archived, _) = crate::archive::list_archived(&c, "").unwrap();
        assert!(archived.iter().all(|i| i.entity != "event"));

        // Stopping after 12 March leaves 5 and 12 March.
        let twelfth: String = c
            .query_row("SELECT id FROM events WHERE series_id = ?1 AND deleted_at IS NULL ORDER BY start_at LIMIT 1 OFFSET 1", [&new_series], |r| r.get(0))
            .unwrap();
        let stopped = set_repeat(&c, &twelfth, None, later).unwrap();
        // 12 March stays, on its own; only 5 March is left in the series.
        assert!(stopped.series_id.is_none() && stopped.deleted_at.is_none());
        assert_eq!(occurrences(&c, &new_series).len(), 1);
    }

    #[test]
    fn an_edited_future_occurrence_is_kept_when_the_repeat_changes() {
        let c = open_in_memory().unwrap();
        let start = Local.with_ymd_and_hms(2026, 3, 2, 18, 0, 0).unwrap();
        let now = (start - Duration::days(1)).with_timezone(&Utc);
        let e = set_repeat(&c, &event_at(&c, start, 60).id, Some(rule("weekly", 1, "", None)), now).unwrap();
        let series = e.series_id.clone().unwrap();
        // Rename the third occurrence by hand (as if done a while ago).
        let third: String = c
            .query_row("SELECT id FROM events WHERE series_id = ?1 ORDER BY start_at LIMIT 1 OFFSET 2", [&series], |r| r.get(0))
            .unwrap();
        c.execute("UPDATE events SET title = 'Sport with Lou', updated_at = '2030-01-01T00:00:00.000Z' WHERE id = ?1", [&third]).unwrap();
        set_repeat(&c, &e.id, Some(rule("daily", 1, "", None)), now).unwrap();
        // The edited one is set aside (kept, out of the calendar); the untouched ones are gone.
        let (deleted, replaced): (Option<String>, i64) =
            c.query_row("SELECT deleted_at, replaced FROM events WHERE id = ?1", [&third], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert!(deleted.is_some() && replaced == 1);
        let old_rows: i64 = c.query_row("SELECT COUNT(*) FROM events WHERE series_id = ?1", [&series], |r| r.get(0)).unwrap();
        assert_eq!(old_rows, 1, "only the edited occurrence remains of the old repeat");
    }

    #[test]
    fn extend_tops_up_an_open_series() {
        let c = open_in_memory().unwrap();
        let start = Local.with_ymd_and_hms(2026, 3, 2, 8, 0, 0).unwrap();
        let now = (start - Duration::hours(1)).with_timezone(&Utc);
        let e = set_repeat(&c, &event_at(&c, start, 15).id, Some(rule("weekly", 1, "", None)), now).unwrap();
        let s = e.series_id.unwrap();
        let before = occurrences(&c, &s).len();
        assert_eq!(extend(&c, now).unwrap(), 0, "nothing new on the same day");
        assert_eq!(extend(&c, now + Duration::days(28)).unwrap(), 4);
        assert_eq!(occurrences(&c, &s).len(), before + 4);
    }

    #[test]
    fn imported_events_do_not_repeat_here() {
        let c = open_in_memory().unwrap();
        let start = Local.with_ymd_and_hms(2026, 3, 2, 8, 0, 0).unwrap();
        let e = event_at(&c, start, 15);
        c.execute("UPDATE events SET source = 'import' WHERE id = ?1", [&e.id]).unwrap();
        assert!(set_repeat(&c, &e.id, Some(rule("daily", 1, "", None)), Utc::now()).is_err());
    }
}
