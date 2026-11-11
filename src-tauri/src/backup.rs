//! Automatic local backups.
//! Decision: one full copy per calendar day, written with VACUUM INTO (a consistent
//! snapshot even while the app is in use). Backups are never rotated away.

use crate::error::Result;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// Writes today's backup if it does not exist yet. Returns the path when one was written.
pub fn run_if_due(conn: &Connection, dir: &Path) -> Result<Option<PathBuf>> {
    std::fs::create_dir_all(dir)?;
    let name = format!("milo-{}.sqlite", chrono::Local::now().format("%Y-%m-%d"));
    let target = dir.join(name);
    if target.exists() {
        return Ok(None);
    }
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])?;
    Ok(Some(target))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_once_per_day() {
        let dir = std::env::temp_dir().join(format!("milo-backup-test-{}", crate::db::new_id()));
        let conn = crate::db::open_in_memory().unwrap();
        let first = run_if_due(&conn, &dir).unwrap().expect("first run writes a backup");
        assert!(run_if_due(&conn, &dir).unwrap().is_none(), "second run the same day does nothing");

        let copy = Connection::open(&first).unwrap();
        let n: i64 = copy.query_row("SELECT COUNT(*) FROM spaces", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 3);
    }
}
