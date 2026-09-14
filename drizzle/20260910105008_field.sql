CREATE TABLE IF NOT EXISTS field_records (shift_id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, plan TEXT NOT NULL, job TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS field_history (id TEXT PRIMARY KEY, shift_id TEXT NOT NULL, organisation_id TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_field_org ON field_records(organisation_id);
CREATE INDEX IF NOT EXISTS idx_field_history ON field_history(organisation_id,shift_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_revision ON field_history(shift_id,revision);
