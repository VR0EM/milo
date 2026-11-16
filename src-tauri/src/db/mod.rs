//! SQLite connection, pragmas and migrations.
//! Decision: one file, one writer (this process), schema version in PRAGMA user_version.

use crate::error::Result;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

impl Db {
    /// The connection. A panic in another thread must not lock the user out of their data.
    pub fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

const MIGRATIONS: &[&str] = &[
    include_str!("migrations/001_core.sql"),
    include_str!("migrations/002_tasks.sql"),
    include_str!("migrations/003_today.sql"),
    include_str!("migrations/004_reminders.sql"),
    include_str!("migrations/005_import.sql"),
    include_str!("migrations/006_semesters.sql"),
    include_str!("migrations/007_priority.sql"),
    include_str!("migrations/008_tasks_import_confirm.sql"),
    include_str!("migrations/009_plan_capture_repeat.sql"),
    include_str!("migrations/010_change_log.sql"),
    include_str!("migrations/011_space_icons.sql"),
    include_str!("migrations/012_todos.sql"),
    include_str!("migrations/013_location.sql"),
    include_str!("migrations/014_focus_routines_reminders.sql"),
];

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    // An AI app (mcp.rs) may write at the same moment: wait for it instead of failing.
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // With WAL, NORMAL is safe: a crash or power cut can lose at most the last moment of work,
    // never corrupt the file. It saves a disk flush on every single change.
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    backup_before_migrating(&conn, path);
    init(conn)
}

/// Before a new version changes the database, a full copy goes next to the daily backups
/// ("milo-before-v10-2026-11-20-091500.sqlite"), so it can be restored from Settings. A copy
/// that cannot be made is reported but does not keep Milo from starting.
fn backup_before_migrating(conn: &Connection, path: &Path) {
    let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap_or(0);
    if version == 0 || version >= MIGRATIONS.len() {
        return; // a new database, or nothing to do
    }
    let Some(dir) = path.parent().map(|d| d.join("backups")) else { return };
    let file = dir.join(format!("milo-before-v{}-{}.sqlite", MIGRATIONS.len(), chrono::Local::now().format("%Y-%m-%d-%H%M%S")));
    let made = std::fs::create_dir_all(&dir)
        .map_err(|e| e.to_string())
        .and_then(|_| conn.execute("VACUUM INTO ?1", [file.to_string_lossy()]).map_err(|e| e.to_string()));
    if let Err(e) = made {
        eprintln!("copy before updating the database failed: {e}");
    }
}

#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    init(Connection::open_in_memory()?)
}

fn init(mut conn: Connection) -> Result<Connection> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// Brings any database (also a restored older backup) up to the current schema.
pub fn migrate(conn: &mut Connection) -> Result<()> {
    // Migrations 012 and 013 use tables from 009 (inbox notes, repeats), so these must be there
    // even on a database that skipped the real 009 (see `repair`).
    let current: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if (9..13).contains(&current) {
        conn.execute_batch(INBOX_TABLE)?;
        conn.execute_batch(SERIES_TABLE)?;
    }
    migrate_to(conn, MIGRATIONS.len())?;
    repair(conn)
}

/// Tables that every database must have, in the same shape their migrations make them.
const INBOX_TABLE: &str = "
CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);";
const SERIES_TABLE: &str = "
CREATE TABLE IF NOT EXISTS event_series (
  id TEXT PRIMARY KEY,
  freq TEXT NOT NULL,
  interval INTEGER NOT NULL DEFAULT 1,
  weekdays TEXT NOT NULL DEFAULT '',
  first_date TEXT NOT NULL,
  until_date TEXT,
  start_time TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  activity_id TEXT REFERENCES activities(id),
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  generated_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);";
const REPAIR_TABLES: &str = "
CREATE TABLE IF NOT EXISTS change_log (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS change_log_entity ON change_log(entity, entity_id, created_at);
CREATE TABLE IF NOT EXISTS focus_session_tasks (
  session_id TEXT NOT NULL REFERENCES focus_sessions(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  PRIMARY KEY (session_id, task_id)
);
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
";

/// Columns that every database must have: (table, column, how to add it).
const REPAIR_COLUMNS: &[(&str, &str, &str)] = &[
    ("events", "task_id", "ALTER TABLE events ADD COLUMN task_id TEXT REFERENCES tasks(id)"),
    ("events", "series_id", "ALTER TABLE events ADD COLUMN series_id TEXT REFERENCES event_series(id)"),
    ("events", "replaced", "ALTER TABLE events ADD COLUMN replaced INTEGER NOT NULL DEFAULT 0"),
    ("spaces", "icon", "ALTER TABLE spaces ADD COLUMN icon TEXT"),
    ("spaces", "kind", "ALTER TABLE spaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'list'"),
    ("tasks", "section_id", "ALTER TABLE tasks ADD COLUMN section_id TEXT REFERENCES sections(id)"),
    ("tasks", "today_on", "ALTER TABLE tasks ADD COLUMN today_on TEXT"),
    ("task_types", "space_id", "ALTER TABLE task_types ADD COLUMN space_id TEXT REFERENCES spaces(id)"),
    ("events", "location", "ALTER TABLE events ADD COLUMN location TEXT NOT NULL DEFAULT ''"),
    ("event_series", "location", "ALTER TABLE event_series ADD COLUMN location TEXT NOT NULL DEFAULT ''"),
    ("events", "reminders", "ALTER TABLE events ADD COLUMN reminders TEXT"),
    ("event_series", "reminders", "ALTER TABLE event_series ADD COLUMN reminders TEXT"),
    ("routines", "space_id", "ALTER TABLE routines ADD COLUMN space_id TEXT REFERENCES spaces(id)"),
    ("routine_items", "parent_id", "ALTER TABLE routine_items ADD COLUMN parent_id TEXT REFERENCES routine_items(id)"),
];

/// Adds what a database lacks although its version says it has it. A development build once
/// marked a database as version 9 after running a different, since removed, migration 9, so
/// the real migration 009 was skipped there. Only missing pieces are added: on a database in
/// order this changes nothing.
fn repair(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(INBOX_TABLE)?;
    tx.execute_batch(SERIES_TABLE)?;
    tx.execute_batch(REPAIR_TABLES)?;
    for (table, column, ddl) in REPAIR_COLUMNS {
        let present: i64 = tx.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
            [table, column],
            |r| r.get(0),
        )?;
        if present == 0 {
            tx.execute_batch(ddl)?;
        }
    }
    tx.execute_batch("CREATE INDEX IF NOT EXISTS events_series ON events(series_id) WHERE series_id IS NOT NULL;")?;
    tx.commit()?;
    Ok(())
}

/// Runs migrations up to and including number `target` (each in its own transaction).
pub fn migrate_to(conn: &mut Connection, target: usize) -> Result<()> {
    let current: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().take(target).skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

/// UTC timestamp in the same shape as JavaScript's `toISOString()`,
/// so stored strings compare correctly as text.
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    /// A database as version 0.3.x left it (schema 8), with some of everything in it.
    fn old_database(conn: &mut Connection) {
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(conn, 8).unwrap();
        let ts = "2026-11-01T10:00:00.000Z";
        conn.execute(
            "INSERT INTO events (id, space_id, title, start_at, end_at, created_at, updated_at) VALUES ('e1', 'seed-space-personal', 'Physics - HOC', '2026-11-02T08:00:00.000Z', '2026-11-02T10:00:00.000Z', ?1, ?1)",
            [ts],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tasks (id, space_id, title, deadline_at, priority, created_at, updated_at) VALUES ('t1', 'seed-space-personal', 'Lab report', '2026-11-20T22:59:00.000Z', 'high', ?1, ?1)",
            [ts],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO focus_sessions (id, space_id, task_id, title, planned_minutes, started_at, ended_at, event_id, created_at, updated_at) VALUES ('f1', 'seed-space-personal', 't1', 'Lab report', 25, ?1, ?1, 'e1', ?1, ?1)",
            [ts],
        )
        .unwrap();
    }

    #[test]
    fn an_old_database_keeps_everything_when_updated() {
        let mut conn = Connection::open_in_memory().unwrap();
        old_database(&mut conn);
        migrate(&mut conn).unwrap();
        let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len());
        let (title, task, series, replaced): (String, Option<String>, Option<String>, i64) = conn
            .query_row("SELECT title, task_id, series_id, replaced FROM events WHERE id = 'e1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap();
        assert_eq!((title.as_str(), task, series, replaced), ("Physics - HOC", None, None, 0));
        let priority: String = conn.query_row("SELECT priority FROM tasks WHERE id = 't1'", [], |r| r.get(0)).unwrap();
        assert_eq!(priority, "high");
        let sessions: i64 = conn.query_row("SELECT COUNT(*) FROM focus_sessions", [], |r| r.get(0)).unwrap();
        assert_eq!(sessions, 1);
        // The new tables work on the updated database.
        conn.execute("INSERT INTO inbox_items (id, text, created_at, updated_at) VALUES ('i1', 'x', ?1, ?1)", params!["2026-11-03T00:00:00.000Z"]).unwrap();
        let fk: i64 = conn.query_row("PRAGMA foreign_key_check", [], |_| Ok(1)).unwrap_or(0);
        assert_eq!(fk, 0, "no broken references");
    }

    #[test]
    fn an_imported_place_moves_out_of_the_notes() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 12).unwrap();
        let ts = "2026-11-03T08:00:00.000Z";
        for (id, notes) in [("a", "Location: ELL.01.01\n\nLabo"), ("b", "Location: Aula A"), ("c", "Bring a calculator")] {
            conn.execute(
                "INSERT INTO events (id, space_id, title, start_at, end_at, notes, created_at, updated_at) VALUES (?1, 'seed-space-personal', 'x', ?2, ?2, ?3, ?2, ?2)",
                params![id, ts, notes],
            )
            .unwrap();
        }
        migrate(&mut conn).unwrap();
        let read = |id: &str| -> (String, String) {
            conn.query_row("SELECT location, notes FROM events WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
        };
        assert_eq!(read("a"), ("ELL.01.01".into(), "Labo".into()));
        assert_eq!(read("b"), ("Aula A".into(), "".into()));
        assert_eq!(read("c"), ("".into(), "Bring a calculator".into()));
    }

    #[test]
    fn open_inbox_notes_become_todos_in_the_inbox() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 11).unwrap();
        let ts = "2026-11-03T08:00:00.000Z";
        conn.execute("INSERT INTO inbox_items (id, text, created_at, updated_at) VALUES ('open', 'Buy paper', ?1, ?1)", [ts]).unwrap();
        conn.execute("INSERT INTO inbox_items (id, text, created_at, updated_at, deleted_at) VALUES ('handled', 'Old', ?1, ?1, ?1)", [ts]).unwrap();
        conn.execute(
            "INSERT INTO groups (id, name, sort_order, created_at, updated_at) VALUES ('g', 'School', 1, ?1, ?1)", [ts],
        ).ok();
        conn.execute(
            "INSERT INTO spaces (id, group_id, name, color, role, sort_order, created_at, updated_at) VALUES ('course', 'g', 'Chemistry', 'teal', 'normal', 5, ?1, ?1)", [ts],
        ).unwrap();
        migrate(&mut conn).unwrap();
        let moved: Vec<(String, String, String)> = conn
            .prepare("SELECT id, space_id, title FROM tasks").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(moved, vec![("open".to_string(), "seed-space-inbox".to_string(), "Buy paper".to_string())]);
        let open: i64 = conn.query_row("SELECT COUNT(*) FROM inbox_items WHERE deleted_at IS NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(open, 0);
        let kind: String = conn.query_row("SELECT kind FROM spaces WHERE id = 'course'", [], |r| r.get(0)).unwrap();
        assert_eq!(kind, "project", "a space in a group is taken to be a course");
    }

    #[test]
    fn a_database_marked_newer_than_it_is_gets_its_missing_parts() {
        // Like the developer's database: an old build ran another "migration 9" (one column)
        // and set the version to 9, so the real migration 009 was skipped.
        let mut conn = Connection::open_in_memory().unwrap();
        old_database(&mut conn);
        conn.execute_batch("ALTER TABLE events ADD COLUMN task_id TEXT; PRAGMA user_version = 9;").unwrap();
        migrate(&mut conn).unwrap();

        for table in ["inbox_items", "event_series", "change_log"] {
            let n: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "{table} is there");
        }
        for (table, column, _) in REPAIR_COLUMNS {
            let n: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2", [table, column], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "{table}.{column} is there");
        }
        // The data is untouched, and the repaired parts work.
        let title: String = conn.query_row("SELECT title FROM events WHERE id = 'e1'", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "Physics - HOC");
        crate::repo::add_inbox(&conn, "works", None, &[]).unwrap();
        // Running it again changes nothing.
        migrate(&mut conn).unwrap();
    }

    #[test]
    fn a_copy_is_made_before_updating() {
        let dir = std::env::temp_dir().join(format!("milo-migrate-test-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("milo.sqlite");
        {
            let mut conn = Connection::open(&path).unwrap();
            old_database(&mut conn);
        }
        let conn = open(&path).unwrap();
        let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len());

        let copies: Vec<_> = std::fs::read_dir(dir.join("backups")).unwrap().map(|e| e.unwrap().path()).collect();
        assert_eq!(copies.len(), 1);
        let name = copies[0].file_name().unwrap().to_string_lossy().to_string();
        assert!(name.starts_with(&format!("milo-before-v{}-", MIGRATIONS.len())) && name.ends_with(".sqlite"), "{name}");
        let old = Connection::open(&copies[0]).unwrap();
        let old_version: usize = old.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(old_version, 8, "the copy is the database as it was");
        let title: String = old.query_row("SELECT title FROM events WHERE id = 'e1'", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "Physics - HOC");

        // Opening again changes nothing and makes no second copy.
        drop(conn);
        open(&path).unwrap();
        assert_eq!(std::fs::read_dir(dir.join("backups")).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
