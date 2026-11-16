//! CSV files of a period, for Excel: every event, or the totals per space as Insights shows them.
//!
//! Written for Excel as it is set up in Belgium and the Netherlands: semicolons between fields,
//! a comma as decimal sign, Windows line ends, and a byte order mark so accents come out right.

use crate::error::{AppError, Result};
use crate::insights;
use chrono::{DateTime, Local, NaiveDate, TimeZone, Utc};
use rusqlite::Connection;

const SEP: &str = ";";
const BOM: &str = "\u{feff}";

/// A field, quoted when it holds a separator, a quote or a line end.
fn field(s: &str) -> String {
    if s.contains([';', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn line(fields: &[String]) -> String {
    fields.iter().map(|f| field(f)).collect::<Vec<_>>().join(SEP) + "\r\n"
}

fn day(s: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| AppError::Invalid(format!("Not a date: {s}")))
}

fn local_midnight(d: NaiveDate) -> DateTime<Utc> {
    let naive = d.and_hms_opt(0, 0, 0).unwrap();
    Local.from_local_datetime(&naive).earliest().map(|t| t.with_timezone(&Utc)).unwrap_or_else(|| Utc.from_utc_datetime(&naive))
}

/// "12,5": hours with a decimal comma.
fn hours(minutes: i64) -> String {
    format!("{:.1}", minutes as f64 / 60.0).replace('.', ",")
}

/// One line per event that starts in [from, to) (local dates, `to` not included).
pub fn events(c: &Connection, from: &str, to: &str) -> Result<String> {
    let (a, b) = (local_midnight(day(from)?), local_midnight(day(to)?));
    let iso = |t: DateTime<Utc>| t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut s = c.prepare(
        "SELECT e.start_at, e.end_at, e.all_day, s.name, IFNULL(g.name, ''), IFNULL(a.name, ''), e.title, e.location, e.status
         FROM events e JOIN spaces s ON s.id = e.space_id
         LEFT JOIN groups g ON g.id = s.group_id LEFT JOIN activities a ON a.id = e.activity_id
         WHERE e.deleted_at IS NULL AND e.start_at >= ?1 AND e.start_at < ?2
         ORDER BY e.start_at, e.end_at",
    )?;
    let mut out = String::from(BOM);
    out += &line(&["Date", "Start", "End", "Minutes", "Space", "Group", "Activity", "Title", "Location", "Happened"].map(String::from));
    let rows = s.query_map([iso(a), iso(b)], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, bool>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, String>(8)?,
        ))
    })?;
    for row in rows {
        let (start, end, all_day, space, group, activity, title, location, status) = row?;
        let (Ok(s0), Ok(e0)) = (DateTime::parse_from_rfc3339(&start), DateTime::parse_from_rfc3339(&end)) else { continue };
        let (s0, e0) = (s0.with_timezone(&Local), e0.with_timezone(&Local));
        let (from_t, to_t, minutes) = if all_day {
            ("all day".to_string(), String::new(), String::new())
        } else {
            (s0.format("%H:%M").to_string(), e0.format("%H:%M").to_string(), (e0 - s0).num_minutes().to_string())
        };
        out += &line(&[
            s0.format("%Y-%m-%d").to_string(),
            from_t,
            to_t,
            minutes,
            space,
            group,
            activity,
            title,
            location,
            if status == "skipped" { "no".into() } else { "yes".into() },
        ]);
    }
    Ok(out)
}

/// The minutes per space, as Insights counts them for [from, to).
pub fn totals(c: &Connection, from: &str, to: &str) -> Result<String> {
    let data = insights::insights_for(c, from, to)?;
    let mut out = String::from(BOM);
    out += &line(&["Space", "Group", "Class (min)", "Self-study (min)", "Other (min)", "Sleep (min)", "Total (min)", "Total (hours)"].map(String::from));
    let (mut sum_c, mut sum_s, mut sum_o, mut sum_z) = (0, 0, 0, 0);
    for s in &data.spaces {
        let (name, group): (String, String) = c
            .query_row(
                "SELECT s.name, IFNULL(g.name, '') FROM spaces s LEFT JOIN groups g ON g.id = s.group_id WHERE s.id = ?1",
                [&s.space_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap_or_else(|_| ("Unknown".into(), String::new()));
        let total = s.class + s.self_study + s.other + s.sleep;
        (sum_c, sum_s, sum_o, sum_z) = (sum_c + s.class, sum_s + s.self_study, sum_o + s.other, sum_z + s.sleep);
        out += &line(&[name, group, s.class.to_string(), s.self_study.to_string(), s.other.to_string(), s.sleep.to_string(), total.to_string(), hours(total)]);
    }
    let all = sum_c + sum_s + sum_o + sum_z;
    out += &line(&["All spaces".into(), String::new(), sum_c.to_string(), sum_s.to_string(), sum_o.to_string(), sum_z.to_string(), all.to_string(), hours(all)]);
    Ok(out)
}

pub fn write(path: &str, content: &str) -> Result<()> {
    Ok(std::fs::write(path, content)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn fields_are_quoted_only_when_needed() {
        assert_eq!(field("Lab"), "Lab");
        assert_eq!(field("Lab; part 2"), "\"Lab; part 2\"");
        assert_eq!(field("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(hours(150), "2,5");
    }

    #[test]
    fn events_and_totals_of_a_period() {
        let c = open_in_memory().unwrap();
        let at = |h: u32| Local.with_ymd_and_hms(2026, 11, 16, h, 0, 0).unwrap().with_timezone(&Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let ts = at(0);
        c.execute(
            "INSERT INTO events (id, space_id, activity_id, title, start_at, end_at, location, created_at, updated_at)
             VALUES ('e1', 'seed-space-personal', 'seed-activity-study', 'Read; chapter 4', ?1, ?2, 'ELL.01.01', ?3, ?3)",
            [at(9), at(11), ts.clone()],
        )
        .unwrap();
        c.execute(
            "INSERT INTO events (id, space_id, title, start_at, end_at, all_day, created_at, updated_at)
             VALUES ('e2', 'seed-space-personal', 'Holiday', ?1, ?2, 1, ?1, ?1)",
            [at(0), at(23)],
        )
        .unwrap();
        let csv = events(&c, "2026-11-16", "2026-11-17").unwrap();
        let lines: Vec<&str> = csv.trim_start_matches(BOM).split("\r\n").collect();
        assert_eq!(lines[0], "Date;Start;End;Minutes;Space;Group;Activity;Title;Location;Happened");
        assert_eq!(lines[1], "2026-11-16;all day;;;Personal;;;Holiday;;yes");
        assert_eq!(lines[2], "2026-11-16;09:00;11:00;120;Personal;;Study;\"Read; chapter 4\";ELL.01.01;yes");
        assert!(events(&c, "2026-11-17", "2026-11-18").unwrap().trim_start_matches(BOM).split("\r\n").nth(1).unwrap().is_empty());

        let t = totals(&c, "2026-11-16", "2026-11-17").unwrap();
        assert!(t.starts_with(BOM));
        assert!(t.contains("Personal;;0;120;"), "{t}");
        assert!(t.contains("All spaces;;0;120;"));
    }
}
