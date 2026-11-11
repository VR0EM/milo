-- Tasks per space, with optional parts that together make up the progress.

CREATE TABLE task_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  type_id TEXT REFERENCES task_types(id),
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  deadline_at TEXT,        -- hard deadline (UTC ISO)
  target_at TEXT,          -- personal target moment (UTC ISO)
  completed_at TEXT,       -- with parts: kept in step with the parts; without: set by hand
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE task_parts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  title TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,   -- share of the progress; all 1 until the UI exposes it
  done_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX task_parts_task ON task_parts(task_id);

INSERT INTO task_types (id, name, sort_order, created_at, updated_at) VALUES
  ('seed-type-assignment', 'Assignment', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('seed-type-theory',     'Theory',     1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('seed-type-lab',        'Lab',        2, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
