/** SQLite table name used by all benchmark apps */
export const BENCHMARK_TABLE_NAME = "benchmark_items";

/** SQL CREATE TABLE statement for the benchmark items table */
export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS benchmark_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('active', 'archived', 'draft')),
  priority    INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 10),
  tags        TEXT    NOT NULL DEFAULT '[]',
  author_name TEXT    NOT NULL,
  author_email TEXT   NOT NULL,
  description TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  version     INTEGER NOT NULL DEFAULT 1
);
`;

/** SQL query to fetch a single benchmark item by ID */
export const SELECT_BY_ID_SQL = `
SELECT id, title, status, priority, tags, author_name, author_email,
       description, created_at, updated_at, version
FROM benchmark_items
WHERE id = ?;
`;

/** SQL query to list benchmark items with pagination */
export const SELECT_LIST_SQL = `
SELECT id, title, status, priority, tags, author_name, author_email,
       description, created_at, updated_at, version
FROM benchmark_items
ORDER BY id
LIMIT ? OFFSET ?;
`;

/** SQL query to insert a new benchmark item */
export const INSERT_SQL = `
INSERT INTO benchmark_items (title, status, priority, tags, author_name, author_email, description)
VALUES (?, ?, ?, ?, ?, ?, ?);
`;
