-- Reminders of one event, in minutes before it starts, comma-separated ("0,10"). NULL: as set
-- in Reminders (the general rule for events); '': none for this event.
ALTER TABLE events ADD COLUMN reminders TEXT;
ALTER TABLE event_series ADD COLUMN reminders TEXT;

-- A routine can follow the events of a space ("Morning routine") instead of set times.
ALTER TABLE routines ADD COLUMN space_id TEXT REFERENCES spaces(id);

-- The to-dos picked for a focus session, and the moment each was ticked off during it, so the
-- session can be written to the calendar as time per to-do.
CREATE TABLE focus_session_tasks (
  session_id TEXT NOT NULL REFERENCES focus_sessions(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  PRIMARY KEY (session_id, task_id)
);
