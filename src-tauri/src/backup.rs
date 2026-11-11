//! Automatic local backups.
//! Decision: one full copy per calendar day, written with VACUUM INTO (a consistent
//! snapshot even while the app is in use). Backups are never rotated away.

use crate::error::{AppError, Result};
use crate::models::BackupFile;
use rusqlite::{backup::Progress, Connection, DatabaseName};
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

/// Backups in `dir`, newest first.
pub fn list(dir: &Path) -> Vec<BackupFile> {
    let mut files: Vec<BackupFile> = std::fs::read_dir(dir)
        .map(|it| {
            it.filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    if !(name.starts_with("milo-") && name.ends_with(".sqlite")) {
                        return None;
                    }
                    let meta = e.metadata().ok()?;
                    let date = name.trim_start_matches("milo-").trim_end_matches(".sqlite").to_string();
                    Some(BackupFile { name, date, bytes: meta.len() })
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort_by(|a, b| b.name.cmp(&a.name));
    files
}

/// Copies every backup that the second folder does not have yet. Returns how many.
pub fn mirror(dir: &Path, to: &Path) -> Result<usize> {
    std::fs::create_dir_all(to)?;
    let mut n = 0;
    for f in list(dir) {
        let target = to.join(&f.name);
        if !target.exists() {
            std::fs::copy(dir.join(&f.name), &target)?;
            n += 1;
        }
    }
    Ok(n)
}

/// Replaces the open database with a backup. The current state is first saved as a backup
/// of its own ("milo-before-restore-…"), so restoring never loses anything.
pub fn restore(conn: &mut Connection, dir: &Path, name: &str) -> Result<PathBuf> {
    let valid = name.starts_with("milo-") && name.ends_with(".sqlite") && !name.contains(['/', '\\']) && !name.contains("..");
    let source = dir.join(name);
    if !valid || !source.is_file() {
        return Err(AppError::Invalid("That backup could not be found".into()));
    }
    let safety = dir.join(format!("milo-before-restore-{}.sqlite", chrono::Local::now().format("%Y-%m-%d-%H%M%S")));
    conn.execute("VACUUM INTO ?1", [safety.to_string_lossy().as_ref()])?;
    conn.restore(DatabaseName::Main, &source, None::<fn(Progress)>)?;
    // A backup from an older Milo is brought up to date.
    crate::db::migrate(conn)?;
    Ok(safety)
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

    #[test]
    fn mirror_and_restore() {
        let root = std::env::temp_dir().join(format!("milo-restore-test-{}", crate::db::new_id()));
        let (dir, other) = (root.join("backups"), root.join("usb"));
        let mut conn = crate::db::open(&root.join("db.sqlite").tap_dir()).unwrap();
        let first = run_if_due(&conn, &dir).unwrap().unwrap();
        let name = first.file_name().unwrap().to_string_lossy().to_string();

        assert_eq!(mirror(&dir, &other).unwrap(), 1);
        assert_eq!(mirror(&dir, &other).unwrap(), 0, "already there");
        assert!(other.join(&name).exists());

        // Change something after the backup, then restore: the change is gone from the live
        // database but kept in the safety copy.
        conn.execute("UPDATE spaces SET name = 'Changed' WHERE id = 'seed-space-personal'", []).unwrap();
        let safety = restore(&mut conn, &dir, &name).unwrap();
        let live: String = conn.query_row("SELECT name FROM spaces WHERE id = 'seed-space-personal'", [], |r| r.get(0)).unwrap();
        assert_eq!(live, "Personal");
        let kept: String = Connection::open(&safety).unwrap()
            .query_row("SELECT name FROM spaces WHERE id = 'seed-space-personal'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, "Changed");
        assert_eq!(list(&dir).len(), 2);

        assert!(restore(&mut conn, &dir, "../db.sqlite").is_err(), "only files from the backup folder");
        assert!(restore(&mut conn, &dir, "milo-1999-01-01.sqlite").is_err());
    }

    trait TapDir {
        fn tap_dir(self) -> Self;
    }
    impl TapDir for PathBuf {
        fn tap_dir(self) -> Self {
            std::fs::create_dir_all(self.parent().unwrap()).unwrap();
            self
        }
    }
}
