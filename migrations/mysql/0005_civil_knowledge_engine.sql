CREATE TABLE `knowledge_packs` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `pack_key` varchar(120) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `discipline` varchar(80),
  `jurisdiction` varchar(80),
  `context_type` varchar(30) NOT NULL DEFAULT 'organisation',
  `context_id` varchar(191),
  `version_label` varchar(60),
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `locked` int NOT NULL DEFAULT 0,
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `knowledge_packs_id` PRIMARY KEY(`id`),
  CONSTRAINT `idx_knowledge_packs_org_key` UNIQUE(`organisation_id`,`pack_key`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_sources` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `pack_id` varchar(191) NOT NULL,
  `title` varchar(255) NOT NULL,
  `authority` varchar(180),
  `source_type` varchar(30) NOT NULL DEFAULT 'organisation',
  `reference_code` varchar(120),
  `revision_label` varchar(80),
  `jurisdiction` varchar(80),
  `effective_from` varchar(10),
  `effective_to` varchar(10),
  `source_url` varchar(512),
  `document_id` varchar(191),
  `licence_note` text,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `verified_by` varchar(191),
  `verified_at` varchar(40),
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `knowledge_sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_rules` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `pack_id` varchar(191) NOT NULL,
  `source_id` varchar(191) NOT NULL,
  `rule_code` varchar(120) NOT NULL,
  `title` varchar(255) NOT NULL,
  `discipline` varchar(80),
  `topic` varchar(120) NOT NULL,
  `rule_type` varchar(30) NOT NULL DEFAULT 'requirement',
  `applies_when` longtext NOT NULL,
  `assertion` longtext,
  `severity` varchar(20) NOT NULL DEFAULT 'warning',
  `message` text NOT NULL,
  `source_clause` varchar(120),
  `source_page` varchar(60),
  `effective_from` varchar(10),
  `effective_to` varchar(10),
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `knowledge_rules_id` PRIMARY KEY(`id`),
  CONSTRAINT `idx_knowledge_rules_org_code` UNIQUE(`organisation_id`,`pack_id`,`rule_code`)
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_packs_org_status` ON `knowledge_packs` (`organisation_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_packs_org_context` ON `knowledge_packs` (`organisation_id`,`context_type`,`context_id`);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_sources_org_pack` ON `knowledge_sources` (`organisation_id`,`pack_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_sources_org_reference` ON `knowledge_sources` (`organisation_id`,`reference_code`);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_rules_org_topic` ON `knowledge_rules` (`organisation_id`,`topic`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_rules_org_pack` ON `knowledge_rules` (`organisation_id`,`pack_id`,`status`);