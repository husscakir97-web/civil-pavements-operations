ALTER TABLE `clients` ADD `client_code` varchar(80);--> statement-breakpoint
ALTER TABLE `clients` ADD `website` varchar(255);--> statement-breakpoint
ALTER TABLE `clients` ADD `billing_email` varchar(254);--> statement-breakpoint
ALTER TABLE `clients` ADD `credit_status` varchar(30);--> statement-breakpoint
ALTER TABLE `clients` ADD `tags` varchar(500);--> statement-breakpoint
ALTER TABLE `clients` ADD `owner_user_id` varchar(191);--> statement-breakpoint
ALTER TABLE `clients` ADD `merged_into_id` varchar(191);--> statement-breakpoint
ALTER TABLE `jobs` ADD `contact_id` varchar(191);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `contact_id` varchar(191);--> statement-breakpoint
ALTER TABLE `client_contacts` ADD `first_name` varchar(80);--> statement-breakpoint
ALTER TABLE `client_contacts` ADD `last_name` varchar(80);--> statement-breakpoint
ALTER TABLE `client_contacts` ADD `department` varchar(120);--> statement-breakpoint
ALTER TABLE `tenders` ADD `contact_id` varchar(191);--> statement-breakpoint
CREATE INDEX `idx_clients_org_abn` ON `clients` (`organisation_id`,`abn`);--> statement-breakpoint
CREATE INDEX `idx_clients_org_code` ON `clients` (`organisation_id`,`client_code`);