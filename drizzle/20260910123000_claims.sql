CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, job_id TEXT NOT NULL, claim_period TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Draft', metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS claim_items (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, claim_id TEXT NOT NULL, docket_id TEXT NOT NULL, line_item TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_claims_org_job_period ON claims(organisation_id, job_id, claim_period);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_items_unique ON claim_items(organisation_id, docket_id);
