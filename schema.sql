-- D1 schema for Free Spikes form submissions
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_type TEXT NOT NULL, -- 'story' or 'contact'
  name TEXT,
  email TEXT,
  trail TEXT,
  content TEXT NOT NULL, -- story or message
  permission INTEGER DEFAULT 0,
  photo_key TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_form_type ON submissions(form_type);
CREATE INDEX IF NOT EXISTS idx_created_at ON submissions(created_at);
