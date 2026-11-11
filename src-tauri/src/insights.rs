//! Insights, computed live from the calendar. Nothing is stored: every number comes
//! from events at the moment it is asked for.
//!
//! - Only time that has passed counts (events are clipped at `now`), and only events
//!   that were not marked "did not happen". All-day events are left out.
//! - Study time = activities in the categories `class` and `self_study`.
//! - Time is split across local days, so an evening that runs past midnight counts
//!   on both days. Sleep is the exception: a night belongs to the day you wake up.

use crate::db::{new_id, now};
use crate::error::{AppError, Result};
use crate::models::*;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone, Utc};
use rusqlite::{params, Connection, Row};
use std::collections::BTreeMap;

fn local_midnight(d: NaiveDate) -> DateTime<Utc> {
    let naive = d.and_hms_opt(0, 0, 0).expect("midnight exists");
    Local
        .from_local_datetime(&naive)
        .earliest()
        .or_else(|| Local.from_local_datetime(&(naive + Duration::hours(1))).earliest())
        .expect("a local time near midnight exists")
        .with_timezone(&Utc)
}

/// The same text shape as stored timestamps, so comparisons in SQL are exact.
fn iso(d: DateTime<Utc>) -> String {
    d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn minutes(a: DateTime<Utc>, b: DateTime<Utc>) -> i64 {
    (b - a).num_seconds().max(0) / 60
}

fn parse_date(s: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| AppError::Invalid(format!("Not a date: {s}")))
}

/// Day buckets for short ranges, Monday-based week buckets for longer ones.
fn bucket_of(d: NaiveDate, weekly: bool) -> NaiveDate {
    if weekly {
        d - Duration::days(d.weekday().num_days_from_monday() as i64)
    } else {
        d
    }
}

/// `from` inclusive, `to` exclusive, both local dates.
pub fn insights(c: &Connection, from: NaiveDate, to: NaiveDate, now: DateTime<Utc>) -> Result<Insights> {
    if to <= from {
        return Err(AppError::Invalid("The end of the period must be after its start".into()));
    }
    let (from_utc, to_utc) = (local_midnight(from), local_midnight(to));
    let limit = to_utc.min(now);
    let weekly = (to - from).num_days() > 31;

    // Every bucket of the period exists, also the empty ones, so the chart has no gaps.
    let mut buckets: BTreeMap<NaiveDate, (i64, i64)> = BTreeMap::new();
    let mut d = from;
    while d < to {
        buckets.entry(bucket_of(d, weekly)).or_default();
        d += Duration::days(1);
    }

    let mut s = c.prepare(
        "SELECT e.start_at, e.end_at, e.space_id, s.role, COALESCE(a.category, 'none')
         FROM events e JOIN spaces s ON s.id = e.space_id LEFT JOIN activities a ON a.id = e.activity_id
         WHERE e.deleted_at IS NULL AND e.status != 'skipped' AND e.all_day = 0
           AND e.start_at < ?2 AND e.end_at > ?1",
    )?;
    let rows = s
        .query_map(params![iso(from_utc), iso(to_utc)], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut totals = InsightTotals::default();
    let mut spaces: BTreeMap<String, SpaceInsight> = BTreeMap::new();
    let mut nights: BTreeMap<NaiveDate, i64> = BTreeMap::new();
    let mut sessions = 0i64;

    for (start, end, space_id, role, category) in rows {
        let (Ok(start), Ok(end)) = (DateTime::parse_from_rfc3339(&start), DateTime::parse_from_rfc3339(&end)) else { continue };
        let (start, end) = (start.with_timezone(&Utc), end.with_timezone(&Utc));
        let (a, b) = (start.max(from_utc), end.min(limit));
        if b <= a {
            continue;
        }

        let m = minutes(a, b);
        let entry = spaces.entry(space_id.clone()).or_insert_with(|| SpaceInsight { space_id, ..Default::default() });
        if role == "sleep" {
            totals.sleep += m;
            entry.sleep += m;
            *nights.entry(end.with_timezone(&Local).date_naive()).or_default() += m;
            continue;
        }

        match category.as_str() {
            "class" => {
                sessions += 1;
                totals.class += m;
                entry.class += m;
            }
            "self_study" => {
                sessions += 1;
                totals.self_study += m;
                entry.self_study += m;
            }
            _ => {
                totals.other += m;
                entry.other += m;
                continue;
            }
        }

        // Split study time over the local days it touches.
        let mut day = a.with_timezone(&Local).date_naive();
        while local_midnight(day) < b {
            let (ds, de) = (local_midnight(day).max(a), local_midnight(day + Duration::days(1)).min(b));
            if de > ds {
                let slot = buckets.entry(bucket_of(day, weekly)).or_default();
                if category == "class" {
                    slot.0 += minutes(ds, de);
                } else {
                    slot.1 += minutes(ds, de);
                }
            }
            day += Duration::days(1);
        }
    }

    let mut spaces: Vec<SpaceInsight> = spaces.into_values().collect();
    spaces.sort_by_key(|s| -(s.class + s.self_study + s.other + s.sleep));
    let nights: Vec<Night> = nights.into_iter().filter(|(d, _)| *d >= from && *d < to).map(|(d, m)| Night { date: d.to_string(), minutes: m }).collect();
    let sleep_average = (!nights.is_empty()).then(|| nights.iter().map(|n| n.minutes).sum::<i64>() / nights.len() as i64);
    let elapsed_days = ((limit - from_utc).num_hours() as f64 / 24.0).ceil().max(0.0) as i64;

    let tasks_done: i64 = c.query_row(
        "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND completed_at >= ?1 AND completed_at < ?2",
        params![iso(from_utc), iso(limit.max(from_utc))],
        |r| r.get(0),
    )?;

    Ok(Insights {
        tasks_done,
        productive_sessions: sessions,
        bucket: if weekly { "week".into() } else { "day".into() },
        buckets: buckets.into_iter().map(|(d, (class, self_study))| Bucket { start: d.to_string(), class, self_study }).collect(),
        totals,
        spaces,
        nights,
        sleep_average,
        elapsed_days,
    })
}

pub fn insights_for(c: &Connection, from: &str, to: &str) -> Result<Insights> {
    insights(c, parse_date(from)?, parse_date(to)?, Utc::now())
}

// ---------- semesters ----------

fn semester_from(r: &Row) -> rusqlite::Result<Semester> {
    Ok(Semester { id: r.get("id")?, name: r.get("name")?, start_date: r.get("start_date")?, end_date: r.get("end_date")? })
}

pub fn list_semesters(c: &Connection) -> Result<Vec<Semester>> {
    let mut s = c.prepare("SELECT * FROM semesters WHERE deleted_at IS NULL ORDER BY start_date DESC")?;
    let rows = s.query_map([], semester_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn check_semester(input: &SemesterInput) -> Result<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::Invalid("Name cannot be empty".into()));
    }
    if parse_date(&input.end_date)? < parse_date(&input.start_date)? {
        return Err(AppError::Invalid("The semester must end after it starts".into()));
    }
    Ok(())
}

pub fn create_semester(c: &Connection, input: SemesterInput) -> Result<Semester> {
    check_semester(&input)?;
    let (id, ts) = (new_id(), now());
    c.execute(
        "INSERT INTO semesters (id, name, start_date, end_date, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, input.name.trim(), input.start_date, input.end_date, ts],
    )?;
    Ok(c.query_row("SELECT * FROM semesters WHERE id = ?1", [&id], semester_from)?)
}

pub fn update_semester(c: &Connection, id: &str, input: SemesterInput) -> Result<Semester> {
    check_semester(&input)?;
    c.execute(
        "UPDATE semesters SET name = ?2, start_date = ?3, end_date = ?4, updated_at = ?5 WHERE id = ?1",
        params![id, input.name.trim(), input.start_date, input.end_date, now()],
    )?;
    Ok(c.query_row("SELECT * FROM semesters WHERE id = ?1", [id], semester_from)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo;

    fn at(d: u32, h: u32, m: u32) -> String {
        iso(Local.with_ymd_and_hms(2026, 11, d, h, m, 0).unwrap().with_timezone(&Utc))
    }

    fn event(c: &Connection, space: &str, activity: Option<&str>, start: String, end: String, status: &str) {
        repo::create_event(
            c,
            EventInput {
                space_id: space.into(), activity_id: activity.map(Into::into), title: "x".into(),
                start_at: start, end_at: end, all_day: false, notes: String::new(), status: status.into(),
            },
            "manual",
        )
        .unwrap();
    }

    #[test]
    fn study_time_split_and_sleep() {
        let c = open_in_memory().unwrap();
        let p = "seed-space-personal";
        // Mon 9 Nov: 2 h class. Tue 10 Nov: 90 min self-study 23:00 -> 00:30 (crosses midnight).
        event(&c, p, Some("seed-activity-class"), at(9, 9, 0), at(9, 11, 0), "planned");
        event(&c, p, Some("seed-activity-study"), at(10, 23, 0), at(11, 0, 30), "planned");
        // Skipped, other, and future events do not count as study.
        event(&c, p, Some("seed-activity-class"), at(12, 9, 0), at(12, 10, 0), "skipped");
        event(&c, "seed-space-transport", None, at(9, 8, 0), at(9, 8, 30), "planned");
        event(&c, p, Some("seed-activity-study"), at(13, 14, 0), at(13, 16, 0), "planned");
        // Sleep: Mon night 23:00 -> Tue 07:00 belongs to Tuesday.
        event(&c, "seed-space-sleep", None, at(9, 23, 0), at(10, 7, 0), "planned");

        let now = Local.with_ymd_and_hms(2026, 11, 13, 15, 0, 0).unwrap().with_timezone(&Utc);
        let week = NaiveDate::from_ymd_opt(2026, 11, 9).unwrap();
        let r = insights(&c, week, week + Duration::days(7), now).unwrap();

        assert_eq!(r.bucket, "day");
        assert_eq!(r.buckets.len(), 7);
        assert_eq!((r.totals.class, r.totals.self_study, r.totals.other), (120, 90 + 60, 30), "the running session counts up to now");
        assert_eq!((r.buckets[0].class, r.buckets[1].self_study, r.buckets[2].self_study), (120, 60, 30), "split at midnight");
        assert_eq!(r.buckets[4].self_study, 60);
        assert_eq!(r.nights.len(), 1);
        assert_eq!((r.nights[0].date.as_str(), r.nights[0].minutes), ("2026-11-10", 480));
        assert_eq!(r.sleep_average, Some(480));
        assert_eq!(r.spaces[0].space_id, "seed-space-sleep", "sorted by total time");
        let personal = r.spaces.iter().find(|s| s.space_id == p).unwrap();
        assert_eq!((personal.class, personal.self_study), (120, 150));
        assert_eq!(r.productive_sessions, 3, "the skipped one does not count; the running one does");
        let sleep = r.spaces.iter().find(|s| s.space_id == "seed-space-sleep").unwrap();
        assert_eq!(sleep.sleep, 480, "sleep is listed with the other spaces");
        assert_eq!(r.tasks_done, 0);

        // A longer range is bucketed per week (Monday start).
        let r = insights(&c, NaiveDate::from_ymd_opt(2026, 9, 21).unwrap(), NaiveDate::from_ymd_opt(2027, 1, 1).unwrap(), now).unwrap();
        assert_eq!(r.bucket, "week");
        let wk = r.buckets.iter().find(|b| b.start == "2026-11-09").unwrap();
        assert_eq!((wk.class, wk.self_study), (120, 150));

        assert!(insights(&c, week, week, now).is_err());
    }

    #[test]
    fn semesters() {
        let c = open_in_memory().unwrap();
        let input = |s: &str, e: &str| SemesterInput { name: "Semester 1".into(), start_date: s.into(), end_date: e.into() };
        assert!(create_semester(&c, input("2027-01-01", "2026-09-01")).is_err());
        assert!(create_semester(&c, input("2026-09-21", "nope")).is_err());
        let s = create_semester(&c, input("2026-09-21", "2027-01-31")).unwrap();
        assert_eq!(list_semesters(&c).unwrap().len(), 1);
        repo::set_archived(&c, "semester", &s.id, true).unwrap();
        assert!(list_semesters(&c).unwrap().is_empty());
    }
}
