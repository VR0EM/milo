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
];

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    init(conn)
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
    let current: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
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
