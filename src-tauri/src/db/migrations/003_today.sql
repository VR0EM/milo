-- Routines (checklists tied to a time window) and focus sessions.

CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,                  -- local wall clock 'HH:MM'
  end_time TEXT NOT NULL,                    -- earlier than start_time means it runs past midnight
  weekdays TEXT NOT NULL DEFAULT '1234567',  -- 1 = Monday ... 7 = Sunday
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE routine_items (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES routines(id),
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- One row per item per day. Unchecking sets deleted_at; the row stays.
CREATE TABLE routine_checks (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES routine_items(id),
  day TEXT NOT NULL,                         -- local date 'YYYY-MM-DD'
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (item_id, day)
);

-- A running session has ended_at NULL, so it survives closing the app.
-- Finishing writes an event (source 'focus') and links it here.
CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  activity_id TEXT REFERENCES activities(id),
  task_id TEXT REFERENCES tasks(id),
  title TEXT NOT NULL DEFAULT '',
  planned_minutes INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  event_id TEXT REFERENCES events(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

INSERT INTO routines (id, name, start_time, end_time, sort_order, created_at, updated_at) VALUES
  ('seed-routine-morning', 'Morning', '07:00', '10:00', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('seed-routine-evening', 'Evening', '21:00', '23:30', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
