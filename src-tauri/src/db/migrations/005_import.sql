-- Imported calendars (ICS links, ICS files, CSV files) and title links.

CREATE TABLE import_sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                  -- 'ics_url' | 'ics_file' | 'csv'
  name TEXT NOT NULL,
  location TEXT NOT NULL,              -- the link, or the file path
  space_id TEXT NOT NULL REFERENCES spaces(id),  -- for titles without a link
  enabled INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_error TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

ALTER TABLE events ADD COLUMN source_id TEXT REFERENCES import_sources(id);
ALTER TABLE events ADD COLUMN external_uid TEXT;
-- Set as soon as the user changes an imported event: from then on their version wins.
ALTER TABLE events ADD COLUMN locally_modified INTEGER NOT NULL DEFAULT 0;
-- Set when a sync archived the event because it left the feed, so it can come back.
ALTER TABLE events ADD COLUMN removed_by_sync INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX events_external ON events(source_id, external_uid) WHERE source_id IS NOT NULL;

-- "Events titled X belong to space Y with activity Z."
CREATE TABLE title_mappings (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'exact',   -- 'exact' | 'contains'
  space_id TEXT NOT NULL REFERENCES spaces(id),
  activity_id TEXT REFERENCES activities(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
