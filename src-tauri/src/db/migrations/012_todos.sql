-- One kind of to-do everywhere, three kinds of spaces, and one Today (see docs/DECISIONS.md).

-- 1. What a space is for: 'project' (a course: parts, types, progress), 'list' (to-dos with
--    steps), 'none' (time only: sleep, travel) or 'inbox' (the one hidden space notes land in).
ALTER TABLE spaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'list';
UPDATE spaces SET kind = 'none' WHERE role = 'sleep' OR id = 'seed-space-transport';
UPDATE spaces SET kind = 'project' WHERE group_id IS NOT NULL AND kind = 'list';

-- 2. The parts of a course ("02 Titration"); a to-do may belong to one.
CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
ALTER TABLE tasks ADD COLUMN section_id TEXT REFERENCES sections(id);

-- 3. The day a to-do was put on Today (local 'YYYY-MM-DD'); NULL = not picked.
ALTER TABLE tasks ADD COLUMN today_on TEXT;

-- 4. A task type can belong to one course; NULL = for every course.
ALTER TABLE task_types ADD COLUMN space_id TEXT REFERENCES spaces(id);

-- 5. A routine step can sit under another ("Pack backpack" > "Laptop").
ALTER TABLE routine_items ADD COLUMN parent_id TEXT REFERENCES routine_items(id);

-- 6. The Inbox becomes a list of to-dos in a hidden space, so a note can go on Today, be
--    ticked off or move to a course like any to-do. Open notes move over; the old rows stay.
INSERT INTO spaces (id, group_id, name, color, role, kind, sort_order, created_at, updated_at)
VALUES ('seed-space-inbox', NULL, 'Inbox', 'gray', 'normal', 'inbox', -1,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO tasks (id, space_id, title, notes, sort_order, created_at, updated_at)
SELECT id, 'seed-space-inbox', text, '', 0, created_at, updated_at FROM inbox_items WHERE deleted_at IS NULL;
UPDATE inbox_items SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE deleted_at IS NULL;
