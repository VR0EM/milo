//! Import sources, title links and the sync that writes occurrences into `events`.
//!
//! Rules (see docs/DECISIONS.md):
//! - Each occurrence is matched to an event by (source, key), so a sync updates instead of duplicating.
//! - An event the user changed or archived is never touched again by a sync: their version wins.
//! - A future event that left the feed is archived (not removed) and comes back if it returns.
//! - Space and activity come from the first matching title link, else the source's space.

use crate::db::{new_id, now, Db};
use crate::error::{AppError, Result};
use crate::ics::{self, Occurrence};
use crate::models::*;
use chrono::{DateTime, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, SecondsFormat, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashSet;

/// Calendar links keep a short history; file imports can bring in older events.
const LINK_HISTORY_DAYS: i64 = 14;
const FILE_HISTORY_DAYS: i64 = 3650;
const FUTURE_DAYS: i64 = 400;
/// Links are refreshed when the last sync is older than this.
pub const LINK_REFRESH_HOURS: i64 = 6;

fn iso(d: DateTime<Utc>) -> String {
    d.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn window(history_days: i64) -> (DateTime<Utc>, DateTime<Utc>) {
    let n = Utc::now();
    (n - Duration::days(history_days), n + Duration::days(FUTURE_DAYS))
}

// ---------- sources ----------

fn source_from(r: &Row) -> rusqlite::Result<ImportSource> {
    Ok(ImportSource {
        id: r.get("id")?,
        kind: r.get("kind")?,
        name: r.get("name")?,
        location: r.get("location")?,
        space_id: r.get("space_id")?,
        enabled: r.get("enabled")?,
        last_synced_at: r.get("last_synced_at")?,
        last_error: r.get("last_error")?,
    })
}

pub fn list_sources(c: &Connection) -> Result<Vec<ImportSource>> {
    let mut s = c.prepare("SELECT * FROM import_sources WHERE deleted_at IS NULL ORDER BY sort_order, created_at")?;
    let rows = s.query_map([], source_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_source(c: &Connection, id: &str) -> Result<ImportSource> {
    Ok(c.query_row("SELECT * FROM import_sources WHERE id = ?1", [id], source_from)?)
}

fn check_link(kind: &str, location: &str) -> Result<()> {
    let l = location.trim().to_ascii_lowercase();
    if kind == "ics_url" && !(l.starts_with("https://") || l.starts_with("http://") || l.starts_with("webcal://")) {
        return Err(AppError::Invalid("A calendar link starts with https:// or webcal://".into()));
    }
    Ok(())
}

pub fn create_source(c: &Connection, kind: &str, input: ImportSourceInput) -> Result<ImportSource> {
    check_link(kind, &input.location)?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Name cannot be empty".into()));
    }
    let (id, ts) = (new_id(), now());
    let sort: i64 = c.query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM import_sources", [], |r| r.get(0))?;
    c.execute(
        "INSERT INTO import_sources (id, kind, name, location, space_id, enabled, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![id, kind, name, input.location.trim(), input.space_id, input.enabled, sort, ts],
    )?;
    get_source(c, &id)
}

pub fn update_source(c: &Connection, id: &str, input: ImportSourceInput) -> Result<ImportSource> {
    let current = get_source(c, id)?;
    check_link(&current.kind, &input.location)?;
    if input.name.trim().is_empty() {
        return Err(AppError::Invalid("Name cannot be empty".into()));
    }
    c.execute(
        "UPDATE import_sources SET name = ?2, location = ?3, space_id = ?4, enabled = ?5, updated_at = ?6 WHERE id = ?1",
        params![id, input.name.trim(), input.location.trim(), input.space_id, input.enabled, now()],
    )?;
    get_source(c, id)
}

fn record_error(c: &Connection, id: &str, message: &str) {
    let _ = c.execute(
        "UPDATE import_sources SET last_error = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, message, now()],
    );
}

// ---------- title links ----------

fn mapping_from(r: &Row) -> rusqlite::Result<TitleMapping> {
    Ok(TitleMapping {
        id: r.get("id")?,
        pattern: r.get("pattern")?,
        match_type: r.get("match_type")?,
        space_id: r.get("space_id")?,
        activity_id: r.get("activity_id")?,
    })
}

pub fn list_mappings(c: &Connection) -> Result<Vec<TitleMapping>> {
    let mut s = c.prepare("SELECT * FROM title_mappings WHERE deleted_at IS NULL ORDER BY sort_order, created_at")?;
    let rows = s.query_map([], mapping_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn check_mapping(input: &TitleMappingInput) -> Result<()> {
    if input.pattern.trim().is_empty() {
        return Err(AppError::Invalid("The title cannot be empty".into()));
    }
    if !["exact", "contains"].contains(&input.match_type.as_str()) {
        return Err(AppError::Invalid(format!("Unknown match type: {}", input.match_type)));
    }
    Ok(())
}

pub fn create_mapping(c: &Connection, input: TitleMappingInput) -> Result<TitleMapping> {
    check_mapping(&input)?;
    let (id, ts) = (new_id(), now());
    let sort: i64 = c.query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM title_mappings", [], |r| r.get(0))?;
    c.execute(
        "INSERT INTO title_mappings (id, pattern, match_type, space_id, activity_id, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, input.pattern.trim(), input.match_type, input.space_id, input.activity_id, sort, ts],
    )?;
    reapply_mappings(c)?;
    Ok(c.query_row("SELECT * FROM title_mappings WHERE id = ?1", [&id], mapping_from)?)
}

pub fn update_mapping(c: &Connection, id: &str, input: TitleMappingInput) -> Result<TitleMapping> {
    check_mapping(&input)?;
    c.execute(
        "UPDATE title_mappings SET pattern = ?2, match_type = ?3, space_id = ?4, activity_id = ?5, updated_at = ?6 WHERE id = ?1",
        params![id, input.pattern.trim(), input.match_type, input.space_id, input.activity_id, now()],
    )?;
    reapply_mappings(c)?;
    Ok(c.query_row("SELECT * FROM title_mappings WHERE id = ?1", [id], mapping_from)?)
}

/// Exact links win over "contains" links; within each kind the oldest link wins.
fn resolve<'a>(mappings: &'a [TitleMapping], title: &str) -> Option<&'a TitleMapping> {
    let t = title.trim().to_lowercase();
    mappings
        .iter()
        .find(|m| m.match_type == "exact" && m.pattern.trim().to_lowercase() == t)
        .or_else(|| mappings.iter().find(|m| m.match_type == "contains" && t.contains(&m.pattern.trim().to_lowercase())))
}

/// Puts every imported event the user has not changed into the space its title link says.
pub fn reapply_mappings(c: &Connection) -> Result<usize> {
    let mappings = list_mappings(c)?;
    let mut s = c.prepare(
        "SELECT id, title, space_id, activity_id FROM events
         WHERE source = 'import' AND locally_modified = 0 AND deleted_at IS NULL",
    )?;
    let rows = s
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut n = 0;
    for (id, title, space, activity) in rows {
        if let Some(m) = resolve(&mappings, &title) {
            if m.space_id != space || m.activity_id != activity {
                c.execute("UPDATE events SET space_id = ?2, activity_id = ?3 WHERE id = ?1", params![id, m.space_id, m.activity_id])?;
                n += 1;
            }
        }
    }
    Ok(n)
}

/// Titles of imported events that no link covers yet, most frequent first.
pub fn unmapped_titles(c: &Connection) -> Result<Vec<UnmappedTitle>> {
    let mappings = list_mappings(c)?;
    let mut s = c.prepare(
        "SELECT title, COUNT(*) AS n FROM events
         WHERE source = 'import' AND locally_modified = 0 AND deleted_at IS NULL AND title != ''
         GROUP BY title ORDER BY n DESC, title",
    )?;
    let rows = s
        .query_map([], |r| Ok(UnmappedTitle { title: r.get(0)?, count: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows.into_iter().filter(|u| resolve(&mappings, &u.title).is_none()).collect())
}

// ---------- sync ----------

/// Writes the occurrences of one source. `full_feed`: the occurrences are the whole
/// calendar, so future events that are missing have left it.
pub fn apply(c: &Connection, source: &ImportSource, occurrences: &[Occurrence], full_feed: bool) -> Result<SyncReport> {
    let tx = c.unchecked_transaction()?;
    let mappings = list_mappings(&tx)?;
    let mut report = SyncReport::default();
    let mut seen = HashSet::new();
    let ts = now();

    for o in occurrences {
        seen.insert(o.key.as_str());
        let (start, end) = (iso(o.start), iso(o.end));
        let mapped = resolve(&mappings, &o.title);
        let existing = tx
            .query_row(
                "SELECT id, locally_modified, deleted_at, removed_by_sync, title, start_at, end_at, all_day, notes
                 FROM events WHERE source_id = ?1 AND external_uid = ?2",
                params![source.id, o.key],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, bool>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, bool>(3)?,
                        (r.get::<_, String>(4)?, r.get::<_, String>(5)?, r.get::<_, String>(6)?, r.get::<_, bool>(7)?, r.get::<_, String>(8)?),
                    ))
                },
            )
            .optional()?;

        match existing {
            None => {
                if o.cancelled {
                    continue;
                }
                let (space, activity) = match mapped {
                    Some(m) => (m.space_id.clone(), m.activity_id.clone()),
                    None => (source.space_id.clone(), None),
                };
                tx.execute(
                    "INSERT INTO events (id, space_id, activity_id, title, start_at, end_at, all_day, notes, status, source,
                     source_id, external_uid, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'planned', 'import', ?9, ?10, ?11, ?11)",
                    params![new_id(), space, activity, o.title, start, end, o.all_day, o.notes, source.id, o.key, ts],
                )?;
                report.added += 1;
            }
            Some((id, local, deleted, by_sync, current)) => {
                if local || (deleted.is_some() && !by_sync) {
                    report.kept += 1;
                    continue;
                }
                if o.cancelled {
                    if deleted.is_none() {
                        tx.execute("UPDATE events SET deleted_at = ?2, removed_by_sync = 1, updated_at = ?2 WHERE id = ?1", params![id, ts])?;
                        report.removed += 1;
                    }
                    continue;
                }
                let fresh = (o.title.clone(), start, end, o.all_day, o.notes.clone());
                if deleted.is_none() && current == fresh {
                    report.unchanged += 1;
                    continue;
                }
                tx.execute(
                    "UPDATE events SET title = ?2, start_at = ?3, end_at = ?4, all_day = ?5, notes = ?6,
                     deleted_at = NULL, removed_by_sync = 0, updated_at = ?7 WHERE id = ?1",
                    params![id, fresh.0, fresh.1, fresh.2, fresh.3, fresh.4, ts],
                )?;
                if let Some(m) = mapped {
                    tx.execute("UPDATE events SET space_id = ?2, activity_id = ?3 WHERE id = ?1", params![id, m.space_id, m.activity_id])?;
                }
                report.updated += 1;
            }
        }
    }

    // An empty feed is more likely a server hiccup than an empty calendar: leave everything.
    if full_feed && !occurrences.is_empty() {
        let gone: Vec<String> = {
            let mut s = tx.prepare(
                "SELECT id, external_uid FROM events
                 WHERE source_id = ?1 AND deleted_at IS NULL AND locally_modified = 0 AND start_at >= ?2",
            )?;
            let rows = s
                .query_map(params![source.id, ts], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows.into_iter().filter(|(_, key)| !seen.contains(key.as_str())).map(|(id, _)| id).collect()
        };
        for id in gone {
            tx.execute("UPDATE events SET deleted_at = ?2, removed_by_sync = 1, updated_at = ?2 WHERE id = ?1", params![id, ts])?;
            report.removed += 1;
        }
    }

    tx.execute(
        "UPDATE import_sources SET last_synced_at = ?2, last_error = NULL, updated_at = ?2 WHERE id = ?1",
        params![source.id, ts],
    )?;
    tx.commit()?;
    Ok(report)
}

fn fetch(url: &str) -> Result<String> {
    let url = url.trim();
    let url = match url.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    };
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Milo calendar import")
        .build();
    match agent.get(&url).call() {
        Ok(resp) => resp.into_string().map_err(|e| AppError::Network(format!("Could not read the calendar: {e}"))),
        Err(ureq::Error::Status(code, _)) => Err(AppError::Network(format!("The server answered with error {code}"))),
        Err(e) => Err(AppError::Network(format!("Could not reach the link: {e}"))),
    }
}

/// Downloads and applies one calendar link. The database is not locked while downloading.
pub fn sync_link(db: &Db, id: &str) -> Result<SyncReport> {
    let source = get_source(&db.lock(), id)?;
    if source.kind != "ics_url" {
        return Err(AppError::Invalid("Only calendar links can be synced; import the file again instead".into()));
    }
    let (from, to) = window(LINK_HISTORY_DAYS);
    let parsed = fetch(&source.location).and_then(|text| ics::parse(&text, from, to).map_err(AppError::Invalid));
    let conn = db.lock();
    match parsed {
        Ok(occurrences) => apply(&conn, &source, &occurrences, true),
        Err(e) => {
            record_error(&conn, id, &e.to_string());
            Err(e)
        }
    }
}

/// Links whose last sync is older than LINK_REFRESH_HOURS (or that never synced).
pub fn links_due(c: &Connection) -> Result<Vec<String>> {
    let cutoff = iso(Utc::now() - Duration::hours(LINK_REFRESH_HOURS));
    Ok(list_sources(c)?
        .into_iter()
        .filter(|s| s.kind == "ics_url" && s.enabled && s.last_synced_at.as_deref().is_none_or(|t| t < cutoff.as_str()))
        .map(|s| s.id)
        .collect())
}

fn read_text(path: &str) -> Result<String> {
    let bytes = std::fs::read(path)?;
    let text = String::from_utf8_lossy(&bytes);
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

fn file_name(path: &str) -> String {
    std::path::Path::new(path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Imported file".into())
}

/// The source for a file: importing the same file again updates the same events.
fn file_source(c: &Connection, kind: &str, path: &str, space_id: &str) -> Result<ImportSource> {
    let existing = list_sources(c)?.into_iter().find(|s| s.kind == kind && s.location == path);
    match existing {
        Some(s) => Ok(s),
        None => create_source(
            c,
            kind,
            ImportSourceInput { name: file_name(path), location: path.into(), space_id: space_id.into(), enabled: true },
        ),
    }
}

pub fn import_ics_file(c: &Connection, path: &str, space_id: &str) -> Result<SyncReport> {
    let (from, to) = window(FILE_HISTORY_DAYS);
    let occurrences = ics::parse(&read_text(path)?, from, to).map_err(AppError::Invalid)?;
    let source = file_source(c, "ics_file", path, space_id)?;
    apply(c, &source, &occurrences, true)
}

// ---------- CSV (Notion) ----------

fn csv_rows(path: &str) -> Result<(Vec<String>, Vec<Vec<String>>)> {
    let text = read_text(path)?;
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(text.as_bytes());
    let headers = reader
        .headers()
        .map_err(|e| AppError::Invalid(format!("Could not read the file as CSV: {e}")))?
        .iter()
        .map(|h| h.trim().to_string())
        .collect();
    let rows = reader
        .records()
        .filter_map(|r| r.ok())
        .map(|r| r.iter().map(|v| v.to_string()).collect())
        .collect();
    Ok((headers, rows))
}

pub fn inspect_csv(path: &str) -> Result<CsvPreview> {
    let (headers, rows) = csv_rows(path)?;
    if headers.is_empty() {
        return Err(AppError::Invalid("The file has no columns".into()));
    }
    let find = |names: &[&str]| headers.iter().position(|h| names.iter().any(|n| h.eq_ignore_ascii_case(n)));
    let title_column = find(&["Name", "Title", "Naam", "Titel"]).unwrap_or(0);
    let date_column = find(&["Date", "Datum", "When"])
        .or_else(|| headers.iter().position(|h| h.to_lowercase().contains("date") || h.to_lowercase().contains("datum")))
        .unwrap_or(1.min(headers.len() - 1));
    Ok(CsvPreview { headers, rows: rows.into_iter().take(5).collect(), title_column, date_column })
}

fn local(naive: NaiveDateTime) -> Option<DateTime<Utc>> {
    Local.from_local_datetime(&naive).earliest().map(|d| d.with_timezone(&Utc))
}

/// One side of a date range: "November 11, 2026 9:00 AM", "2026-11-11", "9:00 AM" (needs `base`), ...
fn parse_date_part(p: &str, base: Option<NaiveDate>) -> Option<(NaiveDateTime, bool)> {
    let p = p.trim();
    if let Ok(d) = DateTime::parse_from_rfc3339(p) {
        return Some((d.with_timezone(&Local).naive_local(), false));
    }
    const WITH_TIME: [&str; 9] = [
        "%B %d, %Y %I:%M %p", "%B %d, %Y %H:%M", "%b %d, %Y %I:%M %p", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M", "%d-%m-%Y %H:%M",
    ];
    const DATE: [&str; 5] = ["%B %d, %Y", "%b %d, %Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"];
    for f in WITH_TIME {
        if let Ok(x) = NaiveDateTime::parse_from_str(p, f) {
            return Some((x, false));
        }
    }
    for f in DATE {
        if let Ok(d) = NaiveDate::parse_from_str(p, f) {
            return Some((d.and_hms_opt(0, 0, 0)?, true));
        }
    }
    let base = base?;
    ["%I:%M %p", "%H:%M"].iter().find_map(|f| NaiveTime::parse_from_str(p, f).ok()).map(|t| (base.and_time(t), false))
}

/// A Notion-style date cell, also accepting ISO dates. Returns start, end, all-day.
pub fn parse_loose_date(raw: &str) -> Option<(DateTime<Utc>, DateTime<Utc>, bool)> {
    let mut s = String::new();
    let mut depth = 0u32;
    for ch in raw.trim().trim_start_matches('@').chars() {
        match ch {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ if depth == 0 => s.push(ch),
            _ => {}
        }
    }
    let s = s.replace("->", "→");
    let mut parts = s.split('→');
    let (start, date_only) = parse_date_part(parts.next()?, None)?;
    let end = parts.next().and_then(|p| parse_date_part(p, Some(start.date())));
    if date_only {
        let last_day = end.map(|(e, _)| e.date()).filter(|d| *d >= start.date()).unwrap_or(start.date());
        let next = last_day.succ_opt()?.and_hms_opt(0, 0, 0)?;
        return Some((local(start)?, local(next)?, true));
    }
    let mut finish = end.map(|(e, _)| e).unwrap_or(start + Duration::hours(1));
    if finish <= start {
        finish = start + Duration::hours(1);
    }
    Some((local(start)?, local(finish)?, false))
}

pub fn import_csv(c: &Connection, path: &str, title_column: usize, date_column: usize, space_id: &str) -> Result<SyncReport> {
    let (headers, rows) = csv_rows(path)?;
    let mut occurrences = Vec::new();
    let mut skipped = 0;
    for row in rows {
        let title = row.get(title_column).map(|t| t.trim().to_string()).unwrap_or_default();
        let date = row.get(date_column).map(|d| d.trim()).unwrap_or("");
        let Some((start, end, all_day)) = parse_loose_date(date) else {
            skipped += 1;
            continue;
        };
        // The other columns become notes, so nothing from the export is lost.
        let notes = headers
            .iter()
            .zip(row.iter())
            .enumerate()
            .filter(|(i, (_, v))| *i != title_column && *i != date_column && !v.trim().is_empty())
            .map(|(_, (h, v))| format!("{h}: {}", v.trim()))
            .collect::<Vec<_>>()
            .join("\n");
        occurrences.push(Occurrence { key: format!("{title}|{date}"), title, notes, start, end, all_day, cancelled: false });
    }
    let source = file_source(c, "csv", path, space_id)?;
    let mut report = apply(c, &source, &occurrences, true)?;
    report.skipped = skipped;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo;

    const FEED: &str = "BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
SUMMARY:Analysis 2 - HOC
DTSTART:20300107T080000Z
DTEND:20300107T100000Z
END:VEVENT
BEGIN:VEVENT
UID:b
SUMMARY:Physics lab
DTSTART:20300108T080000Z
DTEND:20300108T100000Z
END:VEVENT
END:VCALENDAR";

    fn occ(text: &str) -> Vec<Occurrence> {
        let n = Utc::now();
        ics::parse(text, n - Duration::days(1), n + Duration::days(5000)).unwrap()
    }

    fn source(c: &Connection) -> ImportSource {
        create_source(
            c,
            "ics_url",
            ImportSourceInput { name: "School".into(), location: "https://example.com/a.ics".into(), space_id: "seed-space-personal".into(), enabled: true },
        )
        .unwrap()
    }

    fn events(c: &Connection) -> Vec<Event> {
        repo::list_events(c, "2029-01-01T00:00:00.000Z", "2031-01-01T00:00:00.000Z").unwrap()
    }

    #[test]
    fn sync_updates_keeps_local_edits_and_archives_removed() {
        let c = open_in_memory().unwrap();
        let s = source(&c);
        assert!(create_source(&c, "ics_url", ImportSourceInput { name: "X".into(), location: "file:///x".into(), space_id: "seed-space-personal".into(), enabled: true }).is_err());

        let r = apply(&c, &s, &occ(FEED), true).unwrap();
        assert_eq!((r.added, r.updated), (2, 0));
        let r = apply(&c, &s, &occ(FEED), true).unwrap();
        assert_eq!((r.added, r.unchanged), (0, 2), "a second sync does not duplicate");

        // The feed renames one event.
        let renamed = FEED.replace("Physics lab", "Physics lab 2");
        assert_eq!(apply(&c, &s, &occ(&renamed), true).unwrap().updated, 1);

        // The user moves the other one: their version wins from then on.
        let a = events(&c).into_iter().find(|e| e.title.starts_with("Analysis")).unwrap();
        let input = EventInput {
            space_id: a.space_id.clone(), activity_id: None, title: "Analysis (my time)".into(),
            start_at: "2030-01-07T09:00:00.000Z".into(), end_at: "2030-01-07T10:00:00.000Z".into(),
            all_day: false, notes: String::new(), status: "planned".into(),
        };
        repo::update_event(&c, &a.id, input.clone()).unwrap();
        let r = apply(&c, &s, &occ(&renamed), true).unwrap();
        assert_eq!(r.kept, 1);
        assert!(events(&c).iter().any(|e| e.title == "Analysis (my time)" && e.locally_modified));

        // The lab leaves the feed: archived, not removed. It comes back if it returns.
        let only_a = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nSUMMARY:Analysis 2 - HOC\nDTSTART:20300107T080000Z\nDTEND:20300107T100000Z\nEND:VEVENT\nEND:VCALENDAR";
        assert_eq!(apply(&c, &s, &occ(only_a), true).unwrap().removed, 1);
        assert_eq!(events(&c).len(), 1);
        let rows: i64 = c.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 2, "nothing is deleted");
        assert_eq!(apply(&c, &s, &occ(&renamed), true).unwrap().updated, 1);
        assert_eq!(events(&c).len(), 2);

        // An empty feed changes nothing.
        assert_eq!(apply(&c, &s, &[], true).unwrap().removed, 0);
        assert_eq!(events(&c).len(), 2);
    }

    #[test]
    fn title_links_decide_the_space() {
        let c = open_in_memory().unwrap();
        let s = source(&c);
        apply(&c, &s, &occ(FEED), true).unwrap();
        let titles: Vec<String> = unmapped_titles(&c).unwrap().into_iter().map(|u| u.title).collect();
        assert_eq!(titles.len(), 2);

        let analysis = repo::create_space(&c, SpaceInput { group_id: None, name: "Analysis".into(), color: "green".into(), role: "normal".into() }).unwrap();
        create_mapping(&c, TitleMappingInput { pattern: "analysis".into(), match_type: "contains".into(), space_id: analysis.id.clone(), activity_id: Some("seed-activity-class".into()) }).unwrap();
        let a = events(&c).into_iter().find(|e| e.title.starts_with("Analysis")).unwrap();
        assert_eq!((a.space_id.as_str(), a.activity_id.as_deref()), (analysis.id.as_str(), Some("seed-activity-class")));
        assert_eq!(unmapped_titles(&c).unwrap().len(), 1);

        // New events with that title land in the right space straight away.
        let more = FEED.replace("UID:b", "UID:c").replace("Physics lab", "Analysis 2 - WPO");
        apply(&c, &s, &occ(&more), true).unwrap();
        assert!(events(&c).iter().any(|e| e.title == "Analysis 2 - WPO" && e.space_id == analysis.id));
    }

    #[test]
    fn notion_dates() {
        let check = |s: &str| parse_loose_date(s).map(|(a, b, d)| ((b - a).num_minutes(), d));
        assert_eq!(check("November 11, 2026"), Some((1440, true)));
        assert_eq!(check("November 11, 2026 → November 13, 2026"), Some((3 * 1440, true)));
        assert_eq!(check("November 11, 2026 9:00 AM"), Some((60, false)));
        assert_eq!(check("November 11, 2026 9:00 AM → 10:30 AM"), Some((90, false)));
        assert_eq!(check("@November 11, 2026 9:00 AM (GMT+1) → 11:00 AM"), Some((120, false)));
        assert_eq!(check("2026-11-11T09:00"), Some((60, false)));
        assert_eq!(check("11/11/2026"), Some((1440, true)));
        assert_eq!(check("soon"), None);
        assert_eq!(check(""), None);
    }

    #[test]
    fn csv_import() {
        let dir = std::env::temp_dir().join(format!("milo-csv-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Planning.csv");
        std::fs::write(&path, "\u{feff}Name,Date,Tags\nRead chapter 1,\"November 11, 2030 9:00 AM → 10:00 AM\",theory\nNo date,,x\nTrip,\"November 12, 2030\",\n").unwrap();
        let p = path.to_string_lossy().to_string();

        let preview = inspect_csv(&p).unwrap();
        assert_eq!((preview.title_column, preview.date_column), (0, 1));
        assert_eq!(preview.headers, vec!["Name", "Date", "Tags"]);

        let c = open_in_memory().unwrap();
        let r = import_csv(&c, &p, 0, 1, "seed-space-personal").unwrap();
        assert_eq!((r.added, r.skipped), (2, 1));
        assert_eq!(import_csv(&c, &p, 0, 1, "seed-space-personal").unwrap().unchanged, 2, "importing again updates in place");
        let e = events(&c).into_iter().find(|e| e.title == "Read chapter 1").unwrap();
        assert_eq!(e.notes, "Tags: theory");
        assert!(events(&c).iter().any(|e| e.title == "Trip" && e.all_day));
        assert_eq!(list_sources(&c).unwrap().len(), 1);
    }
}
