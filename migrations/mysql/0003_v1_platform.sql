CREATE TABLE `audit_log` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`actor_user_id` varchar(191),
	`actor_email` varchar(254),
	`event_type` varchar(120) NOT NULL,
	`entity_type` varchar(60) NOT NULL,
	`entity_id` varchar(191) NOT NULL,
	`project_id` varchar(191),
	`summary` varchar(500) NOT NULL DEFAULT '',
	`before_state` longtext,
	`after_state` longtext,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `claim_lines` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`claim_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`line_type` varchar(20) NOT NULL,
	`source_id` varchar(191),
	`exclusive_key` varchar(191),
	`description` varchar(500) NOT NULL,
	`contract_value` decimal(15,2) NOT NULL DEFAULT '0',
	`previous_claimed` decimal(15,2) NOT NULL DEFAULT '0',
	`this_claim` decimal(15,2) NOT NULL DEFAULT '0',
	`claimed_to_date` decimal(15,2) NOT NULL DEFAULT '0',
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `claim_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_claim_lines_exclusive` UNIQUE(`organisation_id`,`exclusive_key`)
);
--> statement-breakpoint
CREATE TABLE `client_invoices` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`claim_id` varchar(191),
	`invoice_number` varchar(60) NOT NULL,
	`invoice_date` varchar(10) NOT NULL,
	`due_date` varchar(10),
	`amount_ex_gst` decimal(15,2) NOT NULL,
	`gst` decimal(15,2) NOT NULL,
	`total` decimal(15,2) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`paid_date` varchar(10),
	`paid_amount` decimal(15,2) NOT NULL DEFAULT '0',
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `client_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_invoices_number` UNIQUE(`organisation_id`,`invoice_number`),
	CONSTRAINT `idx_invoices_claim` UNIQUE(`organisation_id`,`claim_id`)
);
--> statement-breakpoint
CREATE TABLE `cost_transactions` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`cost_code` varchar(40),
	`category` varchar(20) NOT NULL,
	`source_type` varchar(20) NOT NULL,
	`source_id` varchar(191) NOT NULL,
	`source_line` varchar(60) NOT NULL,
	`description` varchar(500) NOT NULL,
	`quantity` double NOT NULL DEFAULT 0,
	`unit` varchar(20),
	`rate` decimal(15,2),
	`amount` decimal(15,2) NOT NULL,
	`transaction_date` varchar(10) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'actual',
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `cost_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_cost_source_unique` UNIQUE(`organisation_id`,`source_type`,`source_id`,`source_line`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`context_type` varchar(40) NOT NULL,
	`context_id` varchar(191),
	`project_id` varchar(191),
	`category` varchar(60) NOT NULL DEFAULT 'General',
	`title` varchar(255) NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`content_type` varchar(120) NOT NULL,
	`size_bytes` bigint NOT NULL,
	`storage_key` varchar(512) NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`status` varchar(20) NOT NULL DEFAULT 'current',
	`visibility` varchar(20) NOT NULL DEFAULT 'office',
	`source` varchar(40) NOT NULL DEFAULT 'upload',
	`supersedes_id` varchar(191),
	`uploaded_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `estimate_revisions` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`estimate_id` varchar(191) NOT NULL,
	`revision_number` int NOT NULL,
	`status` varchar(20) NOT NULL,
	`snapshot` longtext NOT NULL,
	`totals` longtext NOT NULL,
	`direct_cost` decimal(15,2) NOT NULL,
	`indirect_cost` decimal(15,2) NOT NULL,
	`contingency` decimal(15,2) NOT NULL,
	`gross_profit` decimal(15,2) NOT NULL,
	`sell_price` decimal(15,2) NOT NULL,
	`gross_margin_pct` double NOT NULL,
	`labour_cost` decimal(15,2) NOT NULL,
	`plant_cost` decimal(15,2) NOT NULL,
	`material_cost` decimal(15,2) NOT NULL,
	`subcontract_cost` decimal(15,2) NOT NULL,
	`other_cost` decimal(15,2) NOT NULL,
	`assumptions` text,
	`exclusions` text,
	`submitted_by` varchar(191),
	`submitted_at` varchar(40),
	`approved_by` varchar(191),
	`approved_at` varchar(40),
	`decision_notes` text,
	`superseded_at` varchar(40),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `estimate_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_estimate_revisions_unique` UNIQUE(`organisation_id`,`estimate_id`,`revision_number`)
);
--> statement-breakpoint
CREATE TABLE `hseq_actions` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191),
	`source_type` varchar(20) NOT NULL DEFAULT 'other',
	`source_id` varchar(191),
	`action` text NOT NULL,
	`owner_user_id` varchar(191),
	`owner_name` varchar(160),
	`due_date` varchar(10),
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`completion_notes` text,
	`completion_document_id` varchar(191),
	`completed_by` varchar(191),
	`completed_at` varchar(40),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `hseq_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hseq_incidents` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191),
	`reference` varchar(40),
	`incident_type` varchar(40) NOT NULL,
	`severity` varchar(20) NOT NULL DEFAULT 'minor',
	`occurred_at` varchar(16) NOT NULL,
	`description` text NOT NULL,
	`immediate_action` text,
	`persons_involved` text,
	`evidence_document_id` varchar(191),
	`status` varchar(20) NOT NULL DEFAULT 'reported',
	`reported_by` varchar(191),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `hseq_incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hseq_ncrs` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191),
	`reference` varchar(40),
	`issue` text NOT NULL,
	`requirement` text,
	`cause` text,
	`corrective_action` text,
	`owner_user_id` varchar(191),
	`owner_name` varchar(160),
	`due_date` varchar(10),
	`verification` text,
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`closed_by` varchar(191),
	`closed_at` varchar(40),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `hseq_ncrs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `itp_items` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`itp_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`sequence` int NOT NULL DEFAULT 1,
	`inspection` text NOT NULL,
	`acceptance_criteria` text,
	`reference` varchar(160),
	`responsibility` varchar(160),
	`point_type` varchar(10) NOT NULL DEFAULT 'none',
	`assigned_user_id` varchar(191),
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`result` text,
	`comments` text,
	`evidence_document_id` varchar(191),
	`completed_by` varchar(191),
	`completed_at` varchar(40),
	`released_by` varchar(191),
	`released_at` varchar(40),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `itp_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `itps` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`reference` varchar(40),
	`title` varchar(255) NOT NULL,
	`activity` varchar(255),
	`specification` varchar(255),
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `itps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `library_items` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`category` varchar(60) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`content` longtext,
	`document_id` varchar(191),
	`expiry_date` varchar(10),
	`owner_user_id` varchar(191),
	`owner_name` varchar(160),
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`version` int NOT NULL DEFAULT 1,
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `library_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `organisation_entitlements` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`module` varchar(40) NOT NULL,
	`status` varchar(20) NOT NULL,
	`source` varchar(40) NOT NULL,
	`plan_code` varchar(60),
	`valid_until` varchar(40),
	`updated_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `organisation_entitlements_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_entitlements_org_module` UNIQUE(`organisation_id`,`module`)
);
--> statement-breakpoint
CREATE TABLE `organisation_profiles` (
	`organisation_id` varchar(191) NOT NULL,
	`legal_name` varchar(255),
	`trading_name` varchar(255),
	`abn` varchar(20),
	`abn_verification` varchar(40) NOT NULL DEFAULT 'format-checked',
	`registered_address` text,
	`operating_address` text,
	`business_activities` text,
	`disciplines` text,
	`operating_regions` text,
	`workforce_size` varchar(40),
	`typical_project_size` varchar(60),
	`plant_summary` text,
	`key_clients` text,
	`certifications` text,
	`tendering_activity` varchar(60),
	`hseq_maturity` varchar(60),
	`estimating_approach` varchar(60),
	`risk_matrix` text,
	`onboarding_step` int NOT NULL DEFAULT 0,
	`onboarding_completed_at` varchar(40),
	`updated_by` varchar(191),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `organisation_profiles_organisation_id` PRIMARY KEY(`organisation_id`)
);
--> statement-breakpoint
CREATE TABLE `progress_claims` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`number` int NOT NULL,
	`period` varchar(7) NOT NULL,
	`claim_date` varchar(10),
	`status` varchar(30) NOT NULL DEFAULT 'draft',
	`gross_amount` decimal(15,2) NOT NULL DEFAULT '0',
	`certified_amount` decimal(15,2),
	`approved_by` varchar(191),
	`approved_at` varchar(40),
	`submitted_by` varchar(191),
	`submitted_at` varchar(40),
	`certified_by` varchar(191),
	`certified_at` varchar(40),
	`notes` text,
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `progress_claims_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_claims_unique` UNIQUE(`organisation_id`,`project_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `project_baselines` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`revision` int NOT NULL,
	`reason` varchar(255) NOT NULL,
	`source_type` varchar(30) NOT NULL,
	`tender_id` varchar(191),
	`estimate_id` varchar(191),
	`estimate_revision_id` varchar(191),
	`variation_id` varchar(191),
	`contract_value` decimal(15,2) NOT NULL,
	`budget_labour` decimal(15,2) NOT NULL,
	`budget_plant` decimal(15,2) NOT NULL,
	`budget_material` decimal(15,2) NOT NULL,
	`budget_subcontract` decimal(15,2) NOT NULL,
	`budget_other` decimal(15,2) NOT NULL,
	`budget_indirect` decimal(15,2) NOT NULL,
	`budget_total` decimal(15,2) NOT NULL,
	`scope` text,
	`assumptions` text,
	`exclusions` text,
	`clarifications` longtext,
	`snapshot` longtext,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `project_baselines_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_baselines_unique` UNIQUE(`organisation_id`,`project_id`,`revision`)
);
--> statement-breakpoint
CREATE TABLE `project_checklist_items` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`phase` varchar(20) NOT NULL,
	`category` varchar(40) NOT NULL,
	`title` varchar(255) NOT NULL,
	`mandatory` int NOT NULL DEFAULT 1,
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`source` varchar(30) NOT NULL DEFAULT 'manual',
	`source_ref` varchar(191),
	`owner_user_id` varchar(191),
	`due_date` varchar(10),
	`evidence_document_id` varchar(191),
	`notes` text,
	`completed_by` varchar(191),
	`completed_at` varchar(40),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `project_checklist_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_checklist_unique` UNIQUE(`organisation_id`,`project_id`,`phase`,`title`)
);
--> statement-breakpoint
CREATE TABLE `project_contacts` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`contact_type` varchar(20) NOT NULL DEFAULT 'team',
	`name` varchar(160) NOT NULL,
	`role` varchar(120),
	`organisation_name` varchar(160),
	`email` varchar(254),
	`phone` varchar(60),
	`user_id` varchar(191),
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `project_contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_cost_codes` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`code` varchar(40) NOT NULL,
	`description` varchar(255) NOT NULL,
	`category` varchar(20) NOT NULL DEFAULT 'other',
	`budget_amount` decimal(15,2) NOT NULL DEFAULT '0',
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `project_cost_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_cost_codes_unique` UNIQUE(`organisation_id`,`project_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `project_variations` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`number` int NOT NULL,
	`reference` varchar(40) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`cause` varchar(60),
	`instruction_source` text,
	`client_reference` varchar(120),
	`notice_date` varchar(10),
	`submitted_date` varchar(10),
	`value` decimal(15,2) NOT NULL DEFAULT '0',
	`cost` decimal(15,2) NOT NULL DEFAULT '0',
	`approved_value` decimal(15,2),
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`approved_by` varchar(191),
	`approved_at` varchar(40),
	`decision_reason` text,
	`linked_docket_ids` text,
	`origin` varchar(20) NOT NULL DEFAULT 'manual',
	`origin_ref` varchar(191),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `project_variations_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_variations_unique` UNIQUE(`organisation_id`,`project_id`,`number`),
	CONSTRAINT `idx_variations_origin` UNIQUE(`organisation_id`,`origin`,`origin_ref`)
);
--> statement-breakpoint
CREATE TABLE `risks` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191),
	`reference` varchar(40),
	`title` varchar(255) NOT NULL,
	`category` varchar(40) NOT NULL DEFAULT 'safety',
	`cause` text,
	`consequence_text` text,
	`initial_likelihood` int,
	`initial_consequence` int,
	`initial_rating` varchar(20),
	`controls` text,
	`residual_likelihood` int,
	`residual_consequence` int,
	`residual_rating` varchar(20),
	`owner_user_id` varchar(191),
	`owner_name` varchar(160),
	`review_date` varchar(10),
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`origin` varchar(20) NOT NULL DEFAULT 'manual',
	`controls_approved_by` varchar(191),
	`controls_approved_at` varchar(40),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `risks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `swms` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`reference` varchar(40),
	`title` varchar(255) NOT NULL,
	`activity` varchar(255) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`current_revision_id` varchar(191),
	`current_revision_number` int NOT NULL DEFAULT 1,
	`issued_revision_id` varchar(191),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `swms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `swms_acknowledgements` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`swms_id` varchar(191) NOT NULL,
	`swms_revision_id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`worker_name` varchar(160) NOT NULL,
	`shift_id` varchar(191),
	`acknowledged_at` varchar(40) NOT NULL,
	CONSTRAINT `swms_acknowledgements_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_swms_ack_unique` UNIQUE(`organisation_id`,`swms_revision_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `swms_revisions` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`swms_id` varchar(191) NOT NULL,
	`revision_number` int NOT NULL,
	`status` varchar(20) NOT NULL,
	`content` longtext NOT NULL,
	`origin` varchar(20) NOT NULL DEFAULT 'manual',
	`change_reason` varchar(500),
	`submitted_by` varchar(191),
	`submitted_at` varchar(40),
	`approved_by` varchar(191),
	`approved_at` varchar(40),
	`issued_by` varchar(191),
	`issued_at` varchar(40),
	`superseded_at` varchar(40),
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `swms_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_swms_revisions_unique` UNIQUE(`organisation_id`,`swms_id`,`revision_number`)
);
--> statement-breakpoint
CREATE TABLE `tender_bid_reviews` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`tender_id` varchar(191) NOT NULL,
	`strategic_fit` text,
	`capacity` text,
	`capability` text,
	`client_assessment` text,
	`location_assessment` text,
	`contract_risks` text,
	`programme` text,
	`resources` text,
	`commercial_risks` text,
	`hseq_risks` text,
	`competition` text,
	`recommendation` varchar(20),
	`recommendation_reason` text,
	`decision` varchar(20) NOT NULL DEFAULT 'pending',
	`decided_by` varchar(191),
	`decided_at` varchar(40),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `tender_bid_reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_bid_reviews_org_tender` UNIQUE(`organisation_id`,`tender_id`)
);
--> statement-breakpoint
CREATE TABLE `tender_clarifications` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`tender_id` varchar(191) NOT NULL,
	`reference` varchar(60),
	`received_date` varchar(10),
	`due_date` varchar(10),
	`source` varchar(160),
	`question` text NOT NULL,
	`owner_user_id` varchar(191),
	`response` text,
	`submitted_date` varchar(10),
	`document_id` varchar(191),
	`scope_impact` text,
	`price_impact` decimal(15,2),
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `tender_clarifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tender_returnables` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`tender_id` varchar(191) NOT NULL,
	`requirement_id` varchar(191),
	`title` varchar(255) NOT NULL,
	`category` varchar(40) NOT NULL DEFAULT 'schedule',
	`mandatory` int NOT NULL DEFAULT 1,
	`assignee_user_id` varchar(191),
	`due_date` varchar(10),
	`status` varchar(20) NOT NULL DEFAULT 'not_started',
	`document_id` varchar(191),
	`library_item_id` varchar(191),
	`notes` text,
	`completed_by` varchar(191),
	`completed_at` varchar(40),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `tender_returnables_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenders` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`opportunity_id` varchar(191) NOT NULL,
	`reference` varchar(80),
	`title` varchar(255) NOT NULL,
	`client_name` varchar(255),
	`owner_user_id` varchar(191),
	`stage` varchar(30) NOT NULL DEFAULT 'draft',
	`due_date` varchar(16),
	`estimated_value` decimal(15,2),
	`location` varchar(255),
	`scope_summary` text,
	`estimate_id` varchar(191),
	`approved_estimate_revision_id` varchar(191),
	`approval_status` varchar(20) NOT NULL DEFAULT 'not_requested',
	`approval_requested_by` varchar(191),
	`approval_requested_at` varchar(40),
	`approved_by` varchar(191),
	`approved_at` varchar(40),
	`approval_notes` text,
	`submitted_at` varchar(40),
	`submitted_by` varchar(191),
	`submission_method` varchar(60),
	`submission_version` varchar(40),
	`submission_notes` text,
	`submission_document_id` varchar(191),
	`submission_override_reason` text,
	`outcome_at` varchar(40),
	`outcome_reason` text,
	`project_id` varchar(191),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `tenders_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_tenders_org_opportunity` UNIQUE(`organisation_id`,`opportunity_id`)
);
--> statement-breakpoint
ALTER TABLE `estimates` ADD `workflow_state` varchar(20);--> statement-breakpoint
ALTER TABLE `estimates` ADD `approved_revision_id` varchar(191);--> statement-breakpoint
ALTER TABLE `estimates` ADD `tender_id` varchar(191);--> statement-breakpoint
ALTER TABLE `estimates` ADD `updated_at` varchar(40);--> statement-breakpoint
ALTER TABLE `jobs` ADD `project_number` varchar(40);--> statement-breakpoint
ALTER TABLE `jobs` ADD `client_name` varchar(255);--> statement-breakpoint
ALTER TABLE `jobs` ADD `stage` varchar(30);--> statement-breakpoint
ALTER TABLE `jobs` ADD `project_manager_user_id` varchar(191);--> statement-breakpoint
ALTER TABLE `jobs` ADD `project_manager_name` varchar(160);--> statement-breakpoint
ALTER TABLE `jobs` ADD `contract_value` decimal(15,2);--> statement-breakpoint
ALTER TABLE `jobs` ADD `original_budget` decimal(15,2);--> statement-breakpoint
ALTER TABLE `jobs` ADD `start_date` varchar(10);--> statement-breakpoint
ALTER TABLE `jobs` ADD `practical_completion_date` varchar(10);--> statement-breakpoint
ALTER TABLE `jobs` ADD `finish_date` varchar(10);--> statement-breakpoint
ALTER TABLE `jobs` ADD `site_address` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `contract_number` varchar(80);--> statement-breakpoint
ALTER TABLE `jobs` ADD `contract_type` varchar(80);--> statement-breakpoint
ALTER TABLE `jobs` ADD `retention_pct` double;--> statement-breakpoint
ALTER TABLE `jobs` ADD `payment_terms_days` int;--> statement-breakpoint
ALTER TABLE `jobs` ADD `defects_months` int;--> statement-breakpoint
ALTER TABLE `jobs` ADD `scope` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `assumptions` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `exclusions` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `client_requirements` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `mobilisation_notes` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_tender_id` varchar(191);--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_estimate_id` varchar(191);--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_estimate_revision_id` varchar(191);--> statement-breakpoint
ALTER TABLE `jobs` ADD `closed_at` varchar(40);--> statement-breakpoint
ALTER TABLE `jobs` ADD `closed_by` varchar(191);--> statement-breakpoint
ALTER TABLE `jobs` ADD `revision` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `updated_at` varchar(40);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `client_name` varchar(255);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `owner_user_id` varchar(191);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `estimated_value` decimal(15,2);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `probability` int;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `closing_date` varchar(10);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `stage` varchar(30);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `location` varchar(255);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `lost_reason` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `tender_id` varchar(191);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `revision` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `created_by` varchar(191);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `updated_at` varchar(40);--> statement-breakpoint
ALTER TABLE `tender_requirements` ADD `tender_id` varchar(191);--> statement-breakpoint
ALTER TABLE `tender_requirements` ADD `category` varchar(40);--> statement-breakpoint
ALTER TABLE `tender_requirements` ADD `response` text;--> statement-breakpoint
ALTER TABLE `tender_requirements` ADD `risk_flag` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tender_requirements` ADD `origin` varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `tender_requirements` ADD `confidence` double;--> statement-breakpoint
ALTER TABLE `tender_requirements` ADD `confirmed_by` varchar(191);--> statement-breakpoint
ALTER TABLE `tender_requirements` ADD `confirmed_at` varchar(40);--> statement-breakpoint
ALTER TABLE `tender_requirements` ADD `evidence_document_id` varchar(191);--> statement-breakpoint
ALTER TABLE `tender_requirements` ADD `revision` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `idx_jobs_source_tender` UNIQUE(`organisation_id`,`source_tender_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_org_created` ON `audit_log` (`organisation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_org_entity` ON `audit_log` (`organisation_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_org_project` ON `audit_log` (`organisation_id`,`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_claim_lines_org_claim` ON `claim_lines` (`organisation_id`,`claim_id`);--> statement-breakpoint
CREATE INDEX `idx_claim_lines_org_source` ON `claim_lines` (`organisation_id`,`line_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_invoices_org_project` ON `client_invoices` (`organisation_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_cost_org_project` ON `cost_transactions` (`organisation_id`,`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_documents_org_context` ON `documents` (`organisation_id`,`context_type`,`context_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_org_project` ON `documents` (`organisation_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_estimate_revisions_status` ON `estimate_revisions` (`organisation_id`,`estimate_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_actions_org_project` ON `hseq_actions` (`organisation_id`,`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_incidents_org_project` ON `hseq_incidents` (`organisation_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_ncrs_org_project` ON `hseq_ncrs` (`organisation_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_itp_items_org_itp` ON `itp_items` (`organisation_id`,`itp_id`);--> statement-breakpoint
CREATE INDEX `idx_itp_items_org_assignee` ON `itp_items` (`organisation_id`,`assigned_user_id`);--> statement-breakpoint
CREATE INDEX `idx_itps_org_project` ON `itps` (`organisation_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_library_org_category` ON `library_items` (`organisation_id`,`category`);--> statement-breakpoint
CREATE INDEX `idx_contacts_org_project` ON `project_contacts` (`organisation_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_risks_org_project` ON `risks` (`organisation_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_swms_org_project` ON `swms` (`organisation_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_clarifications_org_tender` ON `tender_clarifications` (`organisation_id`,`tender_id`);--> statement-breakpoint
CREATE INDEX `idx_returnables_org_tender` ON `tender_returnables` (`organisation_id`,`tender_id`);--> statement-breakpoint
CREATE INDEX `idx_tenders_org_stage` ON `tenders` (`organisation_id`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_estimates_org_tender` ON `estimates` (`organisation_id`,`tender_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_org_stage` ON `jobs` (`organisation_id`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_opportunities_org_stage` ON `opportunities` (`organisation_id`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_tender_requirements_org_tender` ON `tender_requirements` (`organisation_id`,`tender_id`);