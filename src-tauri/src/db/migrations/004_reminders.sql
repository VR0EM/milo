-- Reminder rules and a log of what was fired (so nothing is announced twice).

CREATE TABLE reminder_rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'event' | 'times' | 'interval'
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  minutes_before INTEGER,             -- event: how long before the start
  times TEXT,                         -- times: 'HH:MM,HH:MM' local wall clock
  weekdays TEXT NOT NULL DEFAULT '1234567',
  interval_minutes INTEGER,           -- interval: every N minutes ...
  start_time TEXT,                    -- ... between these local times
  end_time TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE reminder_log (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES reminder_rules(id),
  occurrence TEXT NOT NULL,           -- what exactly was announced, e.g. '2026-11-11T08:00'
  fired_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (rule_id, occurrence)
);

-- Event reminders are on; medication and water are prepared but off until switched on.
INSERT INTO reminder_rules (id, kind, title, enabled, minutes_before, times, interval_minutes, start_time, end_time, sort_order, created_at, updated_at) VALUES
  ('seed-reminder-events',     'event',    'Events',     1, 10,   NULL,    NULL, NULL,    NULL,    0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('seed-reminder-medication', 'times',    'Medication', 0, NULL, '08:00', NULL, NULL,    NULL,    1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('seed-reminder-water',      'interval', 'Water',      0, NULL, NULL,    90,   '09:00', '21:00', 2, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
