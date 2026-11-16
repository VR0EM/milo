-- Where an event takes place ("ELL.01.01"), as a field of its own instead of a line in the notes.
ALTER TABLE events ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE event_series ADD COLUMN location TEXT NOT NULL DEFAULT '';

-- Imported events kept their place as the first line of the notes ("Location: ELL.01.01");
-- it moves to the new field and the notes keep the rest.
UPDATE events SET
  location = trim(substr(notes, 11, CASE WHEN instr(notes, char(10)) > 0 THEN instr(notes, char(10)) - 11 ELSE length(notes) END)),
  notes = CASE WHEN instr(notes, char(10)) > 0 THEN ltrim(substr(notes, instr(notes, char(10)) + 1), char(10)) ELSE '' END
WHERE notes LIKE 'Location: %';
