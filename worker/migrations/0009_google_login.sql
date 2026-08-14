CREATE TABLE IF NOT EXISTS auth_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);
