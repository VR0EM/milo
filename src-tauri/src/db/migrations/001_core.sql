-- Core schema: groups, spaces, activities, events, settings.
-- Every table carries deleted_at. Nothing is ever removed with DELETE.

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES groups(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'blue',      -- palette key, the theme decides the real colour
  role TEXT NOT NULL DEFAULT 'normal',     -- 'normal' | 'sleep' (used by Insights)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',  -- 'class' | 'self_study' | 'other' (used by Insights)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  activity_id TEXT REFERENCES activities(id),
  title TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,                  -- UTC, ISO 8601 with milliseconds and Z
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',  -- 'planned' | 'skipped'; past + planned counts as done
  source TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'focus' | 'import'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX events_range ON events(start_at, end_at) WHERE deleted_at IS NULL;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO activities (id, name, category, sort_order, created_at, updated_at) VALUES
  ('seed-activity-class', 'Class', 'class',      0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('seed-activity-study', 'Study', 'self_study', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('seed-activity-lab',   'Lab',   'class',      2, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('seed-activity-exam',  'Exam',  'other',      3, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO groups (id, name, sort_order, created_at, updated_at) VALUES
  ('seed-group-school', 'School', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO spaces (id, group_id, name, color, role, sort_order, created_at, updated_at) VALUES
  ('seed-space-personal',  NULL, 'Personal',  'blue',   'normal', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('seed-space-sleep',     NULL, 'Sleep',     'purple', 'sleep',  1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('seed-space-transport', NULL, 'Transport', 'gray',   'normal', 2, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
