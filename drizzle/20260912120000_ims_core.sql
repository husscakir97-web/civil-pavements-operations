CREATE TABLE IF NOT EXISTS ims_documents (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'organisation',
  job_id TEXT,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  owner_user_id TEXT,
  approver_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',
  effective_date TEXT,
  review_date TEXT,
  expiry_date TEXT,
  source_requirement_id TEXT,
  storage_attachment_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ims_documents_org_scope ON ims_documents(organisation_id, scope, status);
CREATE INDEX IF NOT EXISTS idx_ims_documents_org_job ON ims_documents(organisation_id, job_id);

CREATE TABLE IF NOT EXISTS ims_document_revisions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  changed_by_user_id TEXT NOT NULL,
  change_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ims_document_revisions_unique ON ims_document_revisions(organisation_id, document_id, revision);

CREATE TABLE IF NOT EXISTS tender_requirements (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  requirement_type TEXT NOT NULL DEFAULT 'Project-specific',
  source_document TEXT NOT NULL DEFAULT '',
  source_page TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'Missing',
  mandatory INTEGER NOT NULL DEFAULT 1,
  clarification TEXT NOT NULL DEFAULT '',
  linked_document_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tender_requirements_org_opp ON tender_requirements(organisation_id, opportunity_id, status);

CREATE TABLE IF NOT EXISTS job_ims_items (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL,
  mandatory INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Missing',
  source_requirement_id TEXT,
  linked_document_id TEXT,
  due_date TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_ims_items_unique ON job_ims_items(organisation_id, job_id, document_type, title);

CREATE TABLE IF NOT EXISTS workflow_tasks (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',
  owner_user_id TEXT,
  due_date TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_org_status ON workflow_tasks(organisation_id, status, due_date);
