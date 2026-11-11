//! A small iCalendar reader for what timetables and Google/Outlook exports contain:
//! VEVENTs with RRULE, EXDATE, RECURRENCE-ID overrides, TZID, all-day dates and
//! STATUS:CANCELLED. Output is a flat list of occurrences, each with a stable key so a
//! later sync can recognise it again.

use chrono::{DateTime, Duration, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence {
    pub key: String,
    pub title: String,
    pub notes: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub all_day: bool,
    pub cancelled: bool,
}

#[derive(Clone, Copy, Debug)]
enum Zone {
    Utc,
    Named(chrono_tz::Tz),
    Floating, // no zone given: the computer's local time
}

#[derive(Clone, Copy, Debug)]
struct Moment {
    naive: NaiveDateTime,
    zone: Zone,
    date_only: bool,
}

/// A local wall-clock time in `tz`. In a daylight-saving gap the next valid hour is used.
fn resolve<T: TimeZone>(tz: &T, naive: NaiveDateTime) -> Option<DateTime<T>> {
    tz.from_local_datetime(&naive)
        .earliest()
        .or_else(|| tz.from_local_datetime(&(naive + Duration::hours(1))).earliest())
}

impl Moment {
    fn to_utc(self) -> Option<DateTime<Utc>> {
        match self.zone {
            Zone::Utc => Some(Utc.from_utc_datetime(&self.naive)),
            Zone::Named(tz) => resolve(&tz, self.naive).map(|d| d.with_timezone(&Utc)),
            Zone::Floating => resolve(&Local, self.naive).map(|d| d.with_timezone(&Utc)),
        }
    }
    fn rrule_tz(self) -> rrule::Tz {
        match self.zone {
            Zone::Utc => rrule::Tz::UTC,
            Zone::Named(tz) => tz.into(),
            Zone::Floating => rrule::Tz::LOCAL,
        }
    }
    /// The part of an occurrence key that identifies this moment.
    fn key(self) -> Option<String> {
        if self.date_only {
            Some(self.naive.format("%Y%m%d").to_string())
        } else {
            self.to_utc().map(|d| d.format("%Y%m%dT%H%M%SZ").to_string())
        }
    }
}

struct Prop {
    name: String,
    params: HashMap<String, String>,
    value: String,
}

fn unfold(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if (line.starts_with(' ') || line.starts_with('\t')) && !out.is_empty() {
            out.last_mut().unwrap().push_str(&line[1..]);
        } else if !line.is_empty() {
            out.push(line.to_string());
        }
    }
    out
}

fn split_unquoted(s: &str, sep: char) -> Vec<&str> {
    let mut parts = Vec::new();
    let (mut quoted, mut from) = (false, 0);
    for (i, ch) in s.char_indices() {
        if ch == '"' {
            quoted = !quoted;
        } else if ch == sep && !quoted {
            parts.push(&s[from..i]);
            from = i + 1;
        }
    }
    parts.push(&s[from..]);
    parts
}

fn parse_prop(line: &str) -> Option<Prop> {
    let mut quoted = false;
    let colon = line.char_indices().find_map(|(i, ch)| {
        if ch == '"' {
            quoted = !quoted;
        }
        (ch == ':' && !quoted).then_some(i)
    })?;
    let mut head = split_unquoted(&line[..colon], ';').into_iter();
    let name = head.next()?.trim().to_ascii_uppercase();
    let params = head
        .filter_map(|p| {
            let (k, v) = p.split_once('=')?;
            Some((k.trim().to_ascii_uppercase(), v.trim().trim_matches('"').to_string()))
        })
        .collect();
    Some(Prop { name, params, value: line[colon + 1..].to_string() })
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push('\n'),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// IANA names, Windows names used by Outlook, and Mozilla-style prefixed names.
fn zone_from_tzid(raw: &str) -> Zone {
    let id = raw.trim().trim_matches('"');
    if let Ok(tz) = id.trim_start_matches('/').parse::<chrono_tz::Tz>() {
        return Zone::Named(tz);
    }
    let windows = match id {
        "W. Europe Standard Time" => Some("Europe/Berlin"),
        "Romance Standard Time" => Some("Europe/Brussels"),
        "Central Europe Standard Time" => Some("Europe/Budapest"),
        "GMT Standard Time" => Some("Europe/London"),
        "UTC" | "Coordinated Universal Time" => Some("UTC"),
        _ => None,
    };
    if let Some(tz) = windows.and_then(|w| w.parse().ok()) {
        return Zone::Named(tz);
    }
    let segments: Vec<&str> = id.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() >= 2 {
        if let Ok(tz) = segments[segments.len() - 2..].join("/").parse::<chrono_tz::Tz>() {
            return Zone::Named(tz);
        }
    }
    Zone::Floating
}

fn parse_moment(value: &str, params: &HashMap<String, String>) -> Option<Moment> {
    let v = value.trim();
    let date_only = params.get("VALUE").is_some_and(|x| x.eq_ignore_ascii_case("DATE")) || v.len() == 8;
    if date_only {
        let d = NaiveDate::parse_from_str(v.get(..8)?, "%Y%m%d").ok()?;
        return Some(Moment { naive: d.and_hms_opt(0, 0, 0)?, zone: Zone::Floating, date_only: true });
    }
    let (body, utc) = match v.strip_suffix('Z') {
        Some(b) => (b, true),
        None => (v, false),
    };
    let naive = NaiveDateTime::parse_from_str(body, "%Y%m%dT%H%M%S")
        .or_else(|_| NaiveDateTime::parse_from_str(body, "%Y%m%dT%H%M"))
        .ok()?;
    let zone = if utc {
        Zone::Utc
    } else {
        params.get("TZID").map(|t| zone_from_tzid(t)).unwrap_or(Zone::Floating)
    };
    Some(Moment { naive, zone, date_only: false })
}

fn parse_duration(raw: &str) -> Option<Duration> {
    let raw = raw.trim();
    let (negative, rest) = match raw.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, raw.strip_prefix('+').unwrap_or(raw)),
    };
    let mut total = Duration::zero();
    let (mut number, mut in_time) = (String::new(), false);
    for ch in rest.strip_prefix('P')?.chars() {
        match ch {
            'T' => in_time = true,
            '0'..='9' => number.push(ch),
            unit => {
                let n: i64 = number.parse().ok()?;
                number.clear();
                total += match (unit, in_time) {
                    ('W', _) => Duration::weeks(n),
                    ('D', _) => Duration::days(n),
                    ('H', true) => Duration::hours(n),
                    ('M', true) => Duration::minutes(n),
                    ('S', true) => Duration::seconds(n),
                    _ => return None,
                };
            }
        }
    }
    Some(if negative { -total } else { total })
}

/// rrule wants UNTIL in UTC when the start has a zone. Feeds often give a date or a
/// local time instead, so it is rewritten here, read in the start's own zone.
fn normalize_until(rule: &str, start: Moment) -> String {
    rule.trim()
        .trim_start_matches("RRULE:")
        .split(';')
        .map(|part| {
            let Some((key, value)) = part.split_once('=') else { return part.to_string() };
            if !key.eq_ignore_ascii_case("UNTIL") || value.ends_with('Z') {
                return part.to_string();
            }
            let moment = if value.len() == 8 {
                NaiveDate::parse_from_str(value, "%Y%m%d").ok().and_then(|d| d.and_hms_opt(23, 59, 59))
            } else {
                NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%S").ok()
            };
            match moment.and_then(|naive| Moment { naive, zone: start.zone, date_only: false }.to_utc()) {
                Some(utc) => format!("UNTIL={}", utc.format("%Y%m%dT%H%M%SZ")),
                None => part.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join(";")
}

struct VEvent {
    uid: String,
    title: String,
    notes: String,
    start: Moment,
    length: Duration,
    cancelled: bool,
    rrule: Option<String>,
    exdates: Vec<Moment>,
    recurrence_id: Option<Moment>,
}

fn read_events(text: &str) -> Vec<VEvent> {
    let mut blocks: Vec<Vec<Prop>> = Vec::new();
    let mut current: Option<Vec<Prop>> = None;
    let mut nested = 0usize;
    for line in unfold(text) {
        let Some(p) = parse_prop(&line) else { continue };
        let value = p.value.trim().to_ascii_uppercase();
        match (p.name.as_str(), value.as_str()) {
            ("BEGIN", "VEVENT") => {
                current = Some(Vec::new());
                nested = 0;
            }
            ("END", "VEVENT") => blocks.extend(current.take()),
            ("BEGIN", _) if current.is_some() => nested += 1,
            ("END", _) if current.is_some() => nested = nested.saturating_sub(1),
            _ if nested == 0 => {
                if let Some(c) = current.as_mut() {
                    c.push(p)
                }
            }
            _ => {}
        }
    }

    blocks
        .into_iter()
        .filter_map(|props| {
            let get = |n: &str| props.iter().find(|p| p.name == n);
            let start_p = get("DTSTART")?;
            let start = parse_moment(&start_p.value, &start_p.params)?;
            let title = get("SUMMARY").map(|p| unescape(p.value.trim())).unwrap_or_default().trim().to_string();
            let uid = get("UID")
                .map(|p| p.value.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| format!("{title}|{}", start_p.value.trim()));

            let mut notes = Vec::new();
            if let Some(l) = get("LOCATION").map(|p| unescape(p.value.trim())).filter(|s| !s.is_empty()) {
                notes.push(format!("Location: {l}"));
            }
            if let Some(d) = get("DESCRIPTION").map(|p| unescape(p.value.trim())).filter(|s| !s.is_empty()) {
                notes.push(d);
            }

            let end = get("DTEND").and_then(|p| parse_moment(&p.value, &p.params));
            let mut length = match end {
                Some(e) if start.date_only => e.naive - start.naive,
                Some(e) => match (e.to_utc(), start.to_utc()) {
                    (Some(a), Some(b)) => a - b,
                    _ => Duration::zero(),
                },
                None => get("DURATION").and_then(|p| parse_duration(&p.value)).unwrap_or_else(Duration::zero),
            };
            if length <= Duration::zero() {
                length = if start.date_only { Duration::days(1) } else { Duration::hours(1) };
            }

            let exdates = props
                .iter()
                .filter(|p| p.name == "EXDATE")
                .flat_map(|p| p.value.split(',').filter_map(|v| parse_moment(v, &p.params)).collect::<Vec<_>>())
                .collect();

            Some(VEvent {
                uid,
                title,
                notes: notes.join("\n\n"),
                start,
                length,
                cancelled: get("STATUS").is_some_and(|p| p.value.trim().eq_ignore_ascii_case("CANCELLED")),
                rrule: get("RRULE").map(|p| p.value.clone()),
                exdates,
                recurrence_id: get("RECURRENCE-ID").and_then(|p| parse_moment(&p.value, &p.params)),
            })
        })
        .collect()
}

fn span(naive: NaiveDateTime, ev: &VEvent) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    if ev.start.date_only {
        let s = resolve(&Local, naive)?.with_timezone(&Utc);
        let e = resolve(&Local, naive + ev.length)?.with_timezone(&Utc);
        Some((s, e))
    } else {
        let s = Moment { naive, ..ev.start }.to_utc()?;
        Some((s, s + ev.length))
    }
}

/// All occurrences in the text. Repeating events are expanded between `from` and `to`;
/// single events are kept when they end after `from`.
pub fn parse(text: &str, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<Vec<Occurrence>, String> {
    if !text.to_ascii_uppercase().contains("BEGIN:VCALENDAR") {
        return Err("This is not a calendar (.ics) file".into());
    }
    let events = read_events(text);

    // An override (RECURRENCE-ID) replaces that one occurrence of the repeating event.
    let overridden: HashSet<String> = events
        .iter()
        .filter_map(|e| Some(format!("{}|{}", e.uid, e.recurrence_id?.key()?)))
        .collect();

    let mut out = Vec::new();
    let mut used = HashSet::new();
    let mut push = |key: String, ev: &VEvent, naive: NaiveDateTime| {
        let Some((start, end)) = span(naive, ev) else { return };
        if end < from {
            return;
        }
        // Some feeds reuse one UID for unrelated events; keep each one apart.
        let key = if used.contains(&key) { format!("{key}|{}", start.format("%Y%m%dT%H%M%SZ")) } else { key };
        used.insert(key.clone());
        out.push(Occurrence { key, title: ev.title.clone(), notes: ev.notes.clone(), start, end, all_day: ev.start.date_only, cancelled: ev.cancelled });
    };

    for ev in &events {
        if let Some(rid) = ev.recurrence_id {
            if let Some(k) = rid.key() {
                push(format!("{}|{k}", ev.uid), ev, ev.start.naive);
            }
            continue;
        }
        let Some(rule) = &ev.rrule else {
            push(ev.uid.clone(), ev, ev.start.naive);
            continue;
        };

        let tz = ev.start.rrule_tz();
        let set = resolve(&tz, ev.start.naive).and_then(|dt| {
            normalize_until(rule, ev.start).parse::<rrule::RRule<rrule::Unvalidated>>().ok()?.build(dt).ok()
        });
        let Some(mut set) = set else {
            // A rule we cannot read: keep the first occurrence rather than nothing.
            push(ev.uid.clone(), ev, ev.start.naive);
            continue;
        };
        for ex in &ev.exdates {
            // A date-only EXDATE on a timed event means "that day, at the usual time".
            let naive = if ex.date_only && !ev.start.date_only { ex.naive.date().and_time(ev.start.naive.time()) } else { ex.naive };
            let ex = Moment { naive, zone: if ex.date_only { ev.start.zone } else { ex.zone }, date_only: false };
            if let Some(dt) = ex.to_utc().map(|u| u.with_timezone(&tz)) {
                set = set.exdate(dt);
            }
        }
        let dates = set
            .after(from.with_timezone(&tz) - (ev.length + Duration::days(1)))
            .before(to.with_timezone(&tz))
            .all(5000)
            .dates;
        for d in dates {
            let naive = d.naive_local();
            let Some(k) = (Moment { naive, ..ev.start }).key() else { continue };
            let key = format!("{}|{k}", ev.uid);
            if !overridden.contains(&key) {
                push(key, ev, naive);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = "BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VTIMEZONE\r
TZID:Europe/Brussels\r
END:VTIMEZONE\r
BEGIN:VEVENT\r
UID:analysis-1\r
SUMMARY:Analysis 2 - HOC\r
LOCATION:Aula A\\, building 3\r
DESCRIPTION:Bring the course notes.\\nChapter 4 today.\r
DTSTART;TZID=Europe/Brussels:20261019T083000\r
DTEND;TZID=Europe/Brussels:20261019T103000\r
RRULE:FREQ=WEEKLY;UNTIL=20261116\r
EXDATE;TZID=Europe/Brussels:20261102T083000\r
BEGIN:VALARM\r
ACTION:DISPLAY\r
SUMMARY:Ignore me\r
END:VALARM\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:analysis-1\r
RECURRENCE-ID;TZID=Europe/Brussels:20261109T083000\r
SUMMARY:Analysis 2 - HOC (moved)\r
DTSTART;TZID=Europe/Brussels:20261109T130000\r
DTEND;TZID=Europe/Brussels:20261109T150000\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:holiday\r
SUMMARY:Autumn break\r
DTSTART;VALUE=DATE:20261102\r
DTEND;VALUE=DATE:20261107\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:exam\r
SUMMARY:Physics exam\r
DTSTART:20270115T090000Z\r
DURATION:PT3H\r
STATUS:CANCELLED\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:long-ago\r
SUMMARY:Old thing\r
DTSTART:20200101T090000Z\r
DTEND:20200101T100000Z\r
END:VEVENT\r
END:VCALENDAR\r
";

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn reads_a_timetable() {
        let occ = parse(FEED, utc("2026-10-01T00:00:00Z"), utc("2027-06-01T00:00:00Z")).unwrap();
        let analysis: Vec<_> = occ.iter().filter(|o| o.key.starts_with("analysis-1")).collect();
        // Weekly 19 Oct .. 16 Nov is five Mondays; 2 Nov is excluded, 9 Nov is moved.
        assert_eq!(analysis.len(), 4, "{analysis:#?}");

        // Summer time: 08:30 in Brussels is 06:30 UTC; after 25 Oct it is 07:30 UTC.
        assert_eq!(analysis[0].start, utc("2026-10-19T06:30:00Z"));
        assert_eq!(analysis[1].start, utc("2026-10-26T07:30:00Z"));
        assert_eq!(analysis[1].end - analysis[1].start, Duration::hours(2));
        assert!(!analysis.iter().any(|o| o.start.format("%m%d").to_string() == "1102"), "EXDATE");

        let moved = analysis.iter().find(|o| o.title.ends_with("(moved)")).unwrap();
        assert_eq!(moved.start, utc("2026-11-09T12:00:00Z"));
        assert_eq!(moved.key, "analysis-1|20261109T073000Z");

        assert_eq!(analysis[0].notes, "Location: Aula A, building 3\n\nBring the course notes.\nChapter 4 today.");
        assert_eq!(analysis[0].title, "Analysis 2 - HOC");

        let holiday = occ.iter().find(|o| o.key == "holiday").unwrap();
        assert!(holiday.all_day);
        assert_eq!((holiday.end - holiday.start).num_days(), 5);

        let exam = occ.iter().find(|o| o.key == "exam").unwrap();
        assert!(exam.cancelled);
        assert_eq!(exam.end - exam.start, Duration::hours(3));

        assert!(!occ.iter().any(|o| o.key == "long-ago"), "ended before the window");
        assert!(parse("hello", utc("2026-10-01T00:00:00Z"), utc("2027-01-01T00:00:00Z")).is_err());
    }

    #[test]
    fn small_parts() {
        assert_eq!(parse_duration("PT1H30M"), Some(Duration::minutes(90)));
        assert_eq!(parse_duration("P1DT2H"), Some(Duration::hours(26)));
        assert_eq!(parse_duration("P2W"), Some(Duration::weeks(2)));
        assert!(matches!(zone_from_tzid("Romance Standard Time"), Zone::Named(_)));
        assert!(matches!(zone_from_tzid("/mozilla.org/20050126_1/Europe/Brussels"), Zone::Named(_)));
        assert!(matches!(zone_from_tzid("Mars/Olympus"), Zone::Floating));
    }
}
