CREATE TABLE `ai_suggestions` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`ledger_id` varchar(191) NOT NULL,
	`feature` varchar(60) NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`entity_id` varchar(191) NOT NULL,
	`field` varchar(80),
	`content` text NOT NULL,
	`source_document_id` varchar(191),
	`source_location` varchar(120),
	`confidence` double,
	`extracted_at` varchar(40) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'suggested',
	`decided_by` varchar(191),
	`decided_at` varchar(40),
	`applied_entity_id` varchar(191),
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `ai_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_usage_ledger` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`idempotency_key` varchar(120) NOT NULL,
	`feature` varchar(60) NOT NULL,
	`provider` varchar(40) NOT NULL,
	`model` varchar(120),
	`status` varchar(20) NOT NULL,
	`input_tokens` int NOT NULL DEFAULT 0,
	`output_tokens` int NOT NULL DEFAULT 0,
	`error` varchar(500),
	`entity_type` varchar(40),
	`entity_id` varchar(191),
	`requested_by` varchar(191) NOT NULL,
	`created_at` varchar(40) NOT NULL,
	`completed_at` varchar(40),
	CONSTRAINT `ai_usage_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_ai_ledger_key` UNIQUE(`organisation_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `app_backfills` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` varchar(80) NOT NULL,
	`status` varchar(20) NOT NULL,
	`counts` text NOT NULL,
	`started_at` varchar(40) NOT NULL,
	`completed_at` varchar(40),
	CONSTRAINT `app_backfills_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `billing_customers` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`provider` varchar(40) NOT NULL,
	`provider_customer_id` varchar(191),
	`billing_email` varchar(254),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `billing_customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_billing_customers_org_provider` UNIQUE(`organisation_id`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `billing_events` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`provider` varchar(40) NOT NULL,
	`event_id` varchar(191) NOT NULL,
	`event_type` varchar(120) NOT NULL,
	`signature_valid` int NOT NULL,
	`status` varchar(20) NOT NULL,
	`error` varchar(500),
	`payload` text NOT NULL,
	`received_at` varchar(40) NOT NULL,
	`processed_at` varchar(40),
	CONSTRAINT `billing_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_billing_events_unique` UNIQUE(`provider`,`event_id`)
);
--> statement-breakpoint
CREATE TABLE `billing_subscriptions` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`provider` varchar(40) NOT NULL,
	`provider_subscription_id` varchar(191),
	`plan_code` varchar(60) NOT NULL,
	`status` varchar(20) NOT NULL,
	`modules` text NOT NULL,
	`trial_ends_at` varchar(40),
	`current_period_end` varchar(40),
	`cancel_at` varchar(40),
	`cancelled_at` varchar(40),
	`last_payment_failed_at` varchar(40),
	`changed_by` varchar(191),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `billing_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_billing_subscriptions_provider` UNIQUE(`provider`,`provider_subscription_id`)
);
--> statement-breakpoint
CREATE TABLE `client_requests` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`client_request_id` varchar(80) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`kind` varchar(40) NOT NULL,
	`entity_type` varchar(40),
	`entity_id` varchar(191),
	`status` varchar(20) NOT NULL,
	`response_status` int NOT NULL DEFAULT 200,
	`response` text,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `client_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_client_requests_unique` UNIQUE(`organisation_id`,`client_request_id`)
);
--> statement-breakpoint
CREATE TABLE `data_migration_issues` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`migration` varchar(60) NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`entity_id` varchar(191) NOT NULL,
	`field` varchar(80) NOT NULL,
	`issue` varchar(500) NOT NULL,
	`legacy_value` text,
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`resolved_by` varchar(191),
	`resolved_at` varchar(40),
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `data_migration_issues_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_migration_issues_unique` UNIQUE(`organisation_id`,`migration`,`entity_type`,`entity_id`,`field`)
);
--> statement-breakpoint
CREATE TABLE `shift_assignments` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`shift_id` varchar(191) NOT NULL,
	`resource_type` varchar(20) NOT NULL,
	`resource_id` varchar(191) NOT NULL,
	`role` varchar(80),
	`start_time` varchar(5),
	`finish_time` varchar(5),
	`source` varchar(20) NOT NULL DEFAULT 'manual',
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `shift_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_assignments_unique` UNIQUE(`organisation_id`,`shift_id`,`resource_type`,`resource_id`)
);
--> statement-breakpoint
CREATE TABLE `worker_competencies` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`worker_id` varchar(191) NOT NULL,
	`competency_type` varchar(160) NOT NULL,
	`reference` varchar(120),
	`issued_date` varchar(10),
	`expiry_date` varchar(10),
	`document_id` varchar(191),
	`status` varchar(20) NOT NULL DEFAULT 'current',
	`source` varchar(20) NOT NULL DEFAULT 'manual',
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `worker_competencies_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_competencies_unique` UNIQUE(`organisation_id`,`worker_id`,`competency_type`)
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `retention_enabled` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `retention_cap_amount` decimal(15,2);--> statement-breakpoint
ALTER TABLE `plant` ADD `plant_number` varchar(60);--> statement-breakpoint
ALTER TABLE `plant` ADD `registration` varchar(40);--> statement-breakpoint
ALTER TABLE `plant` ADD `category` varchar(80);--> statement-breakpoint
ALTER TABLE `plant` ADD `description` varchar(255);--> statement-breakpoint
ALTER TABLE `plant` ADD `make` varchar(80);--> statement-breakpoint
ALTER TABLE `plant` ADD `model` varchar(80);--> statement-breakpoint
ALTER TABLE `plant` ADD `ownership` varchar(20);--> statement-breakpoint
ALTER TABLE `plant` ADD `hourly_rate` decimal(15,2);--> statement-breakpoint
ALTER TABLE `plant` ADD `day_rate` decimal(15,2);--> statement-breakpoint
ALTER TABLE `plant` ADD `compliance_expiry` varchar(10);--> statement-breakpoint
ALTER TABLE `plant` ADD `location` varchar(255);--> statement-breakpoint
ALTER TABLE `plant` ADD `active` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `plant` ADD `revision` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `plant` ADD `created_by` varchar(191);--> statement-breakpoint
ALTER TABLE `plant` ADD `updated_at` varchar(40);--> statement-breakpoint
ALTER TABLE `plant` ADD `legacy_synced_at` varchar(40);--> statement-breakpoint
ALTER TABLE `shifts` ADD `project_id` varchar(191);--> statement-breakpoint
ALTER TABLE `shifts` ADD `shift_date` varchar(10);--> statement-breakpoint
ALTER TABLE `shifts` ADD `start_time` varchar(5);--> statement-breakpoint
ALTER TABLE `shifts` ADD `finish_time` varchar(5);--> statement-breakpoint
ALTER TABLE `shifts` ADD `activity` varchar(255);--> statement-breakpoint
ALTER TABLE `shifts` ADD `supervisor_name` varchar(160);--> statement-breakpoint
ALTER TABLE `shifts` ADD `supervisor_user_id` varchar(191);--> statement-breakpoint
ALTER TABLE `shifts` ADD `location` varchar(255);--> statement-breakpoint
ALTER TABLE `shifts` ADD `instructions` text;--> statement-breakpoint
ALTER TABLE `shifts` ADD `required_competencies` text;--> statement-breakpoint
ALTER TABLE `shifts` ADD `revision` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `shifts` ADD `created_by` varchar(191);--> statement-breakpoint
ALTER TABLE `shifts` ADD `updated_at` varchar(40);--> statement-breakpoint
ALTER TABLE `shifts` ADD `legacy_synced_at` varchar(40);--> statement-breakpoint
ALTER TABLE `workers` ADD `employee_number` varchar(60);--> statement-breakpoint
ALTER TABLE `workers` ADD `first_name` varchar(120);--> statement-breakpoint
ALTER TABLE `workers` ADD `last_name` varchar(120);--> statement-breakpoint
ALTER TABLE `workers` ADD `email` varchar(254);--> statement-breakpoint
ALTER TABLE `workers` ADD `phone` varchar(60);--> statement-breakpoint
ALTER TABLE `workers` ADD `role_title` varchar(120);--> statement-breakpoint
ALTER TABLE `workers` ADD `employment_type` varchar(30);--> statement-breakpoint
ALTER TABLE `workers` ADD `user_id` varchar(191);--> statement-breakpoint
ALTER TABLE `workers` ADD `hourly_rate` decimal(15,2);--> statement-breakpoint
ALTER TABLE `workers` ADD `location` varchar(255);--> statement-breakpoint
ALTER TABLE `workers` ADD `active` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `revision` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `created_by` varchar(191);--> statement-breakpoint
ALTER TABLE `workers` ADD `updated_at` varchar(40);--> statement-breakpoint
ALTER TABLE `workers` ADD `legacy_synced_at` varchar(40);--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `abn_lookup_source` varchar(40);--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `abn_lookup_at` varchar(40);--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `abn_entity_name` varchar(255);--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `abn_entity_type` varchar(120);--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `abn_status` varchar(40);--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `gst_registered_from` varchar(10);--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `ai_enabled` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `ai_enabled_by` varchar(191);--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `ai_enabled_at` varchar(40);--> statement-breakpoint
ALTER TABLE `progress_claims` ADD `retention_withheld` decimal(15,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `progress_claims` ADD `retention_released` decimal(15,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `progress_claims` ADD `retention_release_reason` text;--> statement-breakpoint
ALTER TABLE `progress_claims` ADD `net_amount` decimal(15,2);--> statement-breakpoint
ALTER TABLE `progress_claims` ADD `certified_retention` decimal(15,2);--> statement-breakpoint
ALTER TABLE `progress_claims` ADD `certified_net` decimal(15,2);--> statement-breakpoint
ALTER TABLE `organisation_invitations` ADD `cancelled_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `organisation_invitations` ADD `cancelled_by` varchar(191);--> statement-breakpoint
ALTER TABLE `organisation_invitations` ADD `last_sent_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `organisation_invitations` ADD `send_count` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `idx_jobs_source_estimate` UNIQUE(`organisation_id`,`source_estimate_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_suggestions_org_entity` ON `ai_suggestions` (`organisation_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_suggestions_org_status` ON `ai_suggestions` (`organisation_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_ai_ledger_org_created` ON `ai_usage_ledger` (`organisation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_app_backfills_org_name` ON `app_backfills` (`organisation_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_billing_customers_provider_id` ON `billing_customers` (`provider`,`provider_customer_id`);--> statement-breakpoint
CREATE INDEX `idx_billing_events_org` ON `billing_events` (`organisation_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `idx_billing_subscriptions_org` ON `billing_subscriptions` (`organisation_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_client_requests_org_user` ON `client_requests` (`organisation_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_migration_issues_org_status` ON `data_migration_issues` (`organisation_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_assignments_org_resource` ON `shift_assignments` (`organisation_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_competencies_org_expiry` ON `worker_competencies` (`organisation_id`,`expiry_date`);--> statement-breakpoint
CREATE INDEX `idx_plant_org_active` ON `plant` (`organisation_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_shifts_org_date` ON `shifts` (`organisation_id`,`shift_date`);--> statement-breakpoint
CREATE INDEX `idx_shifts_org_project` ON `shifts` (`organisation_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_workers_org_active` ON `workers` (`organisation_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_workers_org_user` ON `workers` (`organisation_id`,`user_id`);