//! Full export: every row of every table, archived rows included, as one JSON file.
//! Generic over the schema, so new tables are exported without changes here.

use crate::db::now;
use crate::error::Result;
use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde_json::{json, Map, Value};

pub fn export_all(c: &Connection, path: &str) -> Result<usize> {
    let mut tables = Map::new();
    let mut total = 0;
    let names: Vec<String> = {
        let mut s = c.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?;
        let rows = s.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for name in names {
        let mut s = c.prepare(&format!("SELECT * FROM \"{name}\""))?;
        let columns: Vec<String> = s.column_names().iter().map(|c| c.to_string()).collect();
        let mut rows = Vec::new();
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            let mut obj = Map::new();
            for (i, col) in columns.iter().enumerate() {
                let v = match r.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(f) => json!(f),
                    ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
                    ValueRef::Blob(b) => json!(b),
                };
                obj.insert(col.clone(), v);
            }
            rows.push(Value::Object(obj));
        }
        total += rows.len();
        tables.insert(name, Value::Array(rows));
    }
    let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let doc = json!({ "app": "Milo", "format": 1, "exportedAt": now(), "schemaVersion": version, "tables": tables });

    // Write next to the target first, so a failed write never leaves half a file.
    let tmp = format!("{path}.partial");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&doc).expect("JSON values always serialize"))?;
    // Windows refuses to rename onto an existing file, so an overwrite removes it first.
    if std::path::Path::new(path).exists() {
        std::fs::remove_file(path)?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(total)
}

#[cfg(test)]
mod tests {
    #[test]
    fn exports_every_table() {
        let c = crate::db::open_in_memory().unwrap();
        let path = std::env::temp_dir().join(format!("milo-export-{}.json", crate::db::new_id()));
        let n = super::export_all(&c, path.to_str().unwrap()).unwrap();
        let doc: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(doc["app"], "Milo");
        assert_eq!(doc["tables"]["spaces"].as_array().unwrap().len(), 3);
        assert!(doc["tables"]["title_mappings"].is_array());
        assert!(n > 10);
        // Exporting again to the same file replaces it (the Save dialog's "Replace").
        assert!(super::export_all(&c, path.to_str().unwrap()).is_ok());
    }
}
