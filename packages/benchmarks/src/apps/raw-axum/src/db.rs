use rusqlite::{Connection, OpenFlags};

use crate::models::{Author, BenchmarkResponseShape, Metadata};

/// Open the benchmark SQLite database in read-only mode.
pub fn open_db(path: &str) -> Connection {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .unwrap_or_else(|e| panic!("Failed to open database at {path}: {e}"))
}

/// Fetch a single benchmark item by ID, reshaping the flat row into the nested response shape.
pub fn get_item_by_id(conn: &Connection, id: i64) -> Option<BenchmarkResponseShape> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, title, status, priority, tags, author_name, author_email, \
             description, created_at, updated_at, version \
             FROM benchmark_items WHERE id = ?",
        )
        .expect("Failed to prepare statement");

    stmt.query_row([id], |row| {
        let tags_json: String = row.get(4)?;
        let tags: Vec<String> =
            serde_json::from_str(&tags_json).unwrap_or_default();

        Ok(BenchmarkResponseShape {
            id: row.get(0)?,
            title: row.get(1)?,
            status: row.get(2)?,
            priority: row.get(3)?,
            tags,
            author: Author {
                name: row.get(5)?,
                email: row.get(6)?,
            },
            description: row.get(7)?,
            metadata: Metadata {
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                version: row.get(10)?,
            },
        })
    })
    .ok()
}
