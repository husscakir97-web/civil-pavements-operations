CREATE TABLE `hseq_investigations` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `project_id` varchar(191),
  `source_type` varchar(30) NOT NULL,
  `source_id` varchar(191) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'investigating',
  `summary` text,
  `facts` text,
  `finding` text,
  `root_cause` text,
  `root_cause_not_established` int NOT NULL DEFAULT 0,
  `contributing_factors` text,
  `method` varchar(80),
  `investigator_user_id` varchar(191),
  `completed_by` varchar(191),
  `completed_at` varchar(40),
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `hseq_investigations_id` PRIMARY KEY(`id`),
  CONSTRAINT `idx_hseq_investigations_source` UNIQUE(`organisation_id`,`source_type`,`source_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_hseq_investigations_project` ON `hseq_investigations` (`organisation_id`,`project_id`,`status`);
--> statement-breakpoint
CREATE TABLE `hseq_action_reviews` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `action_id` varchar(191) NOT NULL,
  `outcome` varchar(20) NOT NULL,
  `note` text NOT NULL,
  `document_id` varchar(191),
  `reviewer_user_id` varchar(191) NOT NULL,
  `completed_by` varchar(191),
  `completed_at` varchar(40),
  `completion_notes` text,
  `completion_document_id` varchar(191),
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `hseq_action_reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_hseq_action_reviews_action` ON `hseq_action_reviews` (`organisation_id`,`action_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `hseq_actions` ADD `verified_by` varchar(191);
--> statement-breakpoint
ALTER TABLE `hseq_actions` ADD `verified_at` varchar(40);
--> statement-breakpoint
ALTER TABLE `hseq_actions` ADD `verification_note` text;
--> statement-breakpoint
ALTER TABLE `hseq_actions` ADD `verification_document_id` varchar(191);
--> statement-breakpoint
CREATE INDEX `idx_actions_org_source` ON `hseq_actions` (`organisation_id`,`source_type`,`source_id`);
--> statement-breakpoint
CREATE INDEX `idx_actions_org_owner` ON `hseq_actions` (`organisation_id`,`owner_user_id`,`status`);
--> statement-breakpoint
ALTER TABLE `hseq_incidents` ADD `closure_rationale` text;
--> statement-breakpoint
ALTER TABLE `hseq_incidents` ADD `closed_by` varchar(191);
--> statement-breakpoint
ALTER TABLE `hseq_incidents` ADD `closed_at` varchar(40);
