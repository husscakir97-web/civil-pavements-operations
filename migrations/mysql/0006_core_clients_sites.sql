ALTER TABLE `clients` ADD `legal_name` varchar(255);--> statement-breakpoint
ALTER TABLE `clients` ADD `abn` varchar(20);--> statement-breakpoint
ALTER TABLE `clients` ADD `account_reference` varchar(80);--> statement-breakpoint
ALTER TABLE `clients` ADD `payment_terms_days` int;--> statement-breakpoint
ALTER TABLE `clients` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `status` varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `revision` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `created_by` varchar(191);--> statement-breakpoint
ALTER TABLE `clients` ADD `created_at` varchar(40);--> statement-breakpoint
ALTER TABLE `clients` ADD `updated_at` varchar(40);--> statement-breakpoint
CREATE TABLE `client_sites` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `client_id` varchar(191),
  `name` varchar(255) NOT NULL,
  `address` varchar(500),
  `suburb` varchar(120),
  `state` varchar(20),
  `postcode` varchar(10),
  `site_contact` varchar(160),
  `access_notes` text,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `client_sites_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_client_sites_org` ON `client_sites` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_client_sites_org_client` ON `client_sites` (`organisation_id`,`client_id`);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `client_id` varchar(191);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `site_id` varchar(191);--> statement-breakpoint
CREATE INDEX `idx_opportunities_org_client` ON `opportunities` (`organisation_id`,`client_id`);--> statement-breakpoint
ALTER TABLE `tenders` ADD `client_id` varchar(191);--> statement-breakpoint
ALTER TABLE `tenders` ADD `site_id` varchar(191);--> statement-breakpoint
CREATE INDEX `idx_tenders_org_client` ON `tenders` (`organisation_id`,`client_id`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `client_id` varchar(191);--> statement-breakpoint
ALTER TABLE `jobs` ADD `site_id` varchar(191);--> statement-breakpoint
CREATE INDEX `idx_jobs_org_client` ON `jobs` (`organisation_id`,`client_id`);
