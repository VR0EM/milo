-- 1. A calendar link can bring its items in as tasks (deadlines) instead of events.
ALTER TABLE import_sources ADD COLUMN import_as TEXT NOT NULL DEFAULT 'events';  -- 'events' | 'tasks'
ALTER TABLE tasks ADD COLUMN source_id TEXT REFERENCES import_sources(id);
ALTER TABLE tasks ADD COLUMN external_uid TEXT;
ALTER TABLE tasks ADD COLUMN locally_modified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN removed_by_sync INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX tasks_external ON tasks(source_id, external_uid) WHERE source_id IS NOT NULL;

-- 2. Reminders that ask to be confirmed (medication), and when they were.
ALTER TABLE reminder_rules ADD COLUMN ask_confirm INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reminder_log ADD COLUMN confirmed_at TEXT;
UPDATE reminder_rules SET ask_confirm = 1 WHERE id = 'seed-reminder-medication';

-- 3. A notification when a focus session reaches its planned length.
INSERT INTO reminder_rules (id, kind, title, enabled, weekdays, sort_order, created_at, updated_at) VALUES
  ('seed-reminder-focus', 'focus', 'Focus sessions', 1, '1234567', 3, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
