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

CREATE INDEX IF NOT EXISTS idx_benchmark_items_status ON benchmark_items(status);
CREATE INDEX IF NOT EXISTS idx_benchmark_items_priority ON benchmark_items(priority);
