-- Before 0.4.4, archiving a calendar link left its events in the calendar, so a timetable
-- imported twice stayed double. Events and to-dos of an archived link now go with it, at the
-- same moment, so bringing the link back brings them back too.
UPDATE events SET deleted_at = (SELECT s.deleted_at FROM import_sources s WHERE s.id = events.source_id)
WHERE deleted_at IS NULL
  AND source_id IN (SELECT id FROM import_sources WHERE deleted_at IS NOT NULL);

UPDATE tasks SET deleted_at = (SELECT s.deleted_at FROM import_sources s WHERE s.id = tasks.source_id)
WHERE deleted_at IS NULL
  AND source_id IN (SELECT id FROM import_sources WHERE deleted_at IS NOT NULL);
