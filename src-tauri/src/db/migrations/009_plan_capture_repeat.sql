-- 1. Time set aside for a task: an event can belong to a task ("Work on: ...").
ALTER TABLE events ADD COLUMN task_id TEXT REFERENCES tasks(id);

-- 2. Quick notes captured from anywhere, sorted later on Today.
CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT                           -- set when the note is handled or archived
);

-- 7. Repeating events made in Milo. Every occurrence is an ordinary event row with series_id,
--    so reminders, Insights and the calendar treat them like any other event.
CREATE TABLE event_series (
  id TEXT PRIMARY KEY,
  freq TEXT NOT NULL,                       -- 'daily' | 'weekly' | 'monthly'
  interval INTEGER NOT NULL DEFAULT 1,      -- every n days / weeks / months
  weekdays TEXT NOT NULL DEFAULT '',        -- weekly: '135' = Mon, Wed, Fri (1 = Monday)
  first_date TEXT NOT NULL,                 -- local 'YYYY-MM-DD' of the first occurrence
  until_date TEXT,                          -- local 'YYYY-MM-DD', inclusive; NULL = no end
  start_time TEXT NOT NULL,                 -- local 'HH:MM' (ignored for all-day)
  minutes INTEGER NOT NULL,                 -- length; all-day: whole days * 1440
  all_day INTEGER NOT NULL DEFAULT 0,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  activity_id TEXT REFERENCES activities(id),
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  generated_until TEXT NOT NULL,            -- local date up to which occurrences exist
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
ALTER TABLE events ADD COLUMN series_id TEXT REFERENCES event_series(id);
-- Set on future occurrences that a change of the repeat replaced. They stay in the database
-- (nothing is ever deleted) but are not listed in the Archive.
ALTER TABLE events ADD COLUMN replaced INTEGER NOT NULL DEFAULT 0;
CREATE INDEX events_series ON events(series_id) WHERE series_id IS NOT NULL;
