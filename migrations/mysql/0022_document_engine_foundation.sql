CREATE TABLE `managed_documents` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `document_number` varchar(80),
  `document_type` varchar(80),
  `discipline` varchar(80),
  `tags` text,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `current_version_id` varchar(191),
  `context_type` varchar(40) NOT NULL,
  `context_id` varchar(191),
  `project_id` varchar(191),
  `source` varchar(40) NOT NULL DEFAULT 'upload',
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `managed_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_managed_documents_org` ON `managed_documents` (`organisation_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_managed_documents_context` ON `managed_documents` (`organisation_id`,`context_type`,`context_id`);
--> statement-breakpoint
CREATE INDEX `idx_managed_documents_project` ON `managed_documents` (`organisation_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_managed_documents_number` ON `managed_documents` (`organisation_id`,`document_number`);
--> statement-breakpoint
CREATE TABLE `document_versions` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `managed_document_id` varchar(191) NOT NULL,
  `version_number` int NOT NULL,
  `revision_label` varchar(40),
  `file_document_id` varchar(191) NOT NULL,
  `sha256` varchar(64) NOT NULL,
  `issue_date` varchar(10),
  `author` varchar(120),
  `company` varchar(120),
  `change_note` text,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `document_versions_id` PRIMARY KEY(`id`),
  CONSTRAINT `idx_document_versions_seq` UNIQUE(`organisation_id`,`managed_document_id`,`version_number`),
  CONSTRAINT `idx_document_versions_file` UNIQUE(`organisation_id`,`file_document_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_document_versions_org` ON `document_versions` (`organisation_id`);
--> statement-breakpoint
CREATE TABLE `document_links` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `managed_document_id` varchar(191) NOT NULL,
  `target_type` varchar(40) NOT NULL,
  `target_id` varchar(191) NOT NULL,
  `relationship` varchar(40) NOT NULL DEFAULT 'reference',
  `project_id` varchar(191),
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `document_links_id` PRIMARY KEY(`id`),
  CONSTRAINT `idx_document_links_unique` UNIQUE(`organisation_id`,`managed_document_id`,`target_type`,`target_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_document_links_target` ON `document_links` (`organisation_id`,`target_type`,`target_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_links_project` ON `document_links` (`organisation_id`,`project_id`);
