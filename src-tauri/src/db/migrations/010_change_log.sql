-- Earlier versions of events and tasks, so an edit can be undone ("Earlier versions" in the
-- panel). A burst of quick edits is kept as one version.
CREATE TABLE change_log (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,          -- 'event' | 'task'
  entity_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,        -- the row as JSON, as it was before the change
  created_at TEXT NOT NULL
);
CREATE INDEX change_log_entity ON change_log(entity, entity_id, created_at);
