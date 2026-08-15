ALTER TABLE deals ADD COLUMN notion_export_status TEXT NOT NULL DEFAULT 'IDLE' CHECK (notion_export_status IN ('IDLE', 'FAILED'));
ALTER TABLE deals ADD COLUMN notion_export_error TEXT;
ALTER TABLE deals ADD COLUMN notion_export_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deals ADD COLUMN calendar_sync_status TEXT NOT NULL DEFAULT 'IDLE' CHECK (calendar_sync_status IN ('IDLE', 'FAILED'));
ALTER TABLE deals ADD COLUMN calendar_sync_error TEXT;
ALTER TABLE deals ADD COLUMN calendar_sync_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deals ADD COLUMN calendar_draft_event_id TEXT;
ALTER TABLE deals ADD COLUMN calendar_publish_event_id TEXT;
ALTER TABLE deals ADD COLUMN calendar_payment_event_id TEXT;
