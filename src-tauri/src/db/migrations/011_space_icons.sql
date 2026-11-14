-- A small drawn icon per space, shown in the space's colour. NULL shows the plain square.
ALTER TABLE spaces ADD COLUMN icon TEXT;
UPDATE spaces SET icon = 'home' WHERE id = 'seed-space-personal' AND icon IS NULL;
UPDATE spaces SET icon = 'moon' WHERE id = 'seed-space-sleep' AND icon IS NULL;
UPDATE spaces SET icon = 'bus' WHERE id = 'seed-space-transport' AND icon IS NULL;
