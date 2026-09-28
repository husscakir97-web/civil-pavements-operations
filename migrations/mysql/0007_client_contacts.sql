CREATE TABLE `client_contacts` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `client_id` varchar(191) NOT NULL,
  `name` varchar(160) NOT NULL,
  `role` varchar(120),
  `email` varchar(254),
  `phone` varchar(60),
  `mobile` varchar(60),
  `is_primary` int NOT NULL DEFAULT 0,
  `notes` text,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `client_contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_client_contacts_org` ON `client_contacts` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_client_contacts_org_client` ON `client_contacts` (`organisation_id`,`client_id`);
