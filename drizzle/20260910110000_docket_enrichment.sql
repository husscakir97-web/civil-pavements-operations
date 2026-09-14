ALTER TABLE dockets ADD COLUMN source_page REAL;
ALTER TABLE dockets ADD COLUMN source_crop TEXT NOT NULL DEFAULT 'full-page';
ALTER TABLE dockets ADD COLUMN field_confidence TEXT NOT NULL DEFAULT '{}';
ALTER TABLE dockets ADD COLUMN line_items TEXT NOT NULL DEFAULT '[]';
ALTER TABLE dockets ADD COLUMN links TEXT NOT NULL DEFAULT '{}';
ALTER TABLE dockets ADD COLUMN extraction_method TEXT NOT NULL DEFAULT 'local-ocr';
ALTER TABLE dockets ADD COLUMN profile_id TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS extraction_profiles (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, name TEXT NOT NULL, supplier TEXT NOT NULL DEFAULT '', client TEXT NOT NULL DEFAULT '', docket_type TEXT NOT NULL DEFAULT '', rules TEXT NOT NULL DEFAULT '{}', sample_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_extraction_profiles_org ON extraction_profiles(organisation_id);
