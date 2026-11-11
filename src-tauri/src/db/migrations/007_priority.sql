-- Optional task priority: 'low' | 'medium' | 'high', or NULL for none.
ALTER TABLE tasks ADD COLUMN priority TEXT;
