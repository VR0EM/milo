-- Named date ranges for Insights ("Semester 1 2026-27").
CREATE TABLE semesters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,   -- local date 'YYYY-MM-DD', inclusive
  end_date TEXT NOT NULL,     -- local date 'YYYY-MM-DD', inclusive
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
