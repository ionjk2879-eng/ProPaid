ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN last_active_at TEXT;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_deletion', 'dormant'));
ALTER TABLE users ADD COLUMN deletion_scheduled_at TEXT;
