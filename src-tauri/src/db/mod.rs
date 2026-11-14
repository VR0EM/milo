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
];

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
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
    migrate_to(conn, MIGRATIONS.len())
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
