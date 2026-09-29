CREATE TABLE `form_templates` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `module` varchar(40) NOT NULL DEFAULT 'ims',
  `name` varchar(180) NOT NULL,
  `description` text,
  `category` varchar(60) NOT NULL DEFAULT 'General',
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `current_version_id` varchar(191),
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `form_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_form_templates_org` ON `form_templates` (`organisation_id`,`module`,`status`);
--> statement-breakpoint
CREATE TABLE `form_template_versions` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `template_id` varchar(191) NOT NULL,
  `version_number` int NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `schema_json` longtext NOT NULL,
  `change_reason` varchar(500),
  `published_by` varchar(191),
  `published_at` varchar(40),
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `form_template_versions_id` PRIMARY KEY(`id`),
  CONSTRAINT `idx_form_template_versions_number` UNIQUE(`organisation_id`,`template_id`,`version_number`)
);
--> statement-breakpoint
CREATE INDEX `idx_form_template_versions_org` ON `form_template_versions` (`organisation_id`,`template_id`,`status`);
--> statement-breakpoint
CREATE TABLE `form_submissions` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `template_id` varchar(191) NOT NULL,
  `template_version_id` varchar(191) NOT NULL,
  `context_type` varchar(40) NOT NULL,
  `context_id` varchar(191) NOT NULL,
  `project_id` varchar(191),
  `responses_json` longtext NOT NULL,
  `provenance_json` longtext,
  `submitted_by` varchar(191) NOT NULL,
  `submitted_at` varchar(40) NOT NULL,
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `form_submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_form_submissions_org` ON `form_submissions` (`organisation_id`,`submitted_at`);
--> statement-breakpoint
CREATE INDEX `idx_form_submissions_context` ON `form_submissions` (`organisation_id`,`context_type`,`context_id`);
--> statement-breakpoint
CREATE INDEX `idx_form_submissions_project` ON `form_submissions` (`organisation_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_form_submissions_template` ON `form_submissions` (`organisation_id`,`template_id`);
--> statement-breakpoint
CREATE TABLE `form_submission_amendments` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `submission_id` varchar(191) NOT NULL,
  `sequence` int NOT NULL,
  `responses_json` longtext NOT NULL,
  `changed_fields` text,
  `reason` varchar(1000) NOT NULL,
  `amended_by` varchar(191) NOT NULL,
  `amended_at` varchar(40) NOT NULL,
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `form_submission_amendments_id` PRIMARY KEY(`id`),
  CONSTRAINT `idx_form_submission_amendments_seq` UNIQUE(`organisation_id`,`submission_id`,`sequence`)
);
--> statement-breakpoint
CREATE INDEX `idx_form_submission_amendments_org` ON `form_submission_amendments` (`organisation_id`);
