CREATE TABLE `workshop_entries` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`order_id` varchar(191) NOT NULL,
	`kind` varchar(30) NOT NULL,
	`note` text NOT NULL,
	`labour_hours` decimal(10,2),
	`parts` text,
	`actor_id` varchar(191) NOT NULL,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `workshop_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workshop_orders` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`asset_id` varchar(191) NOT NULL,
	`title` varchar(180) NOT NULL,
	`severity` varchar(20) NOT NULL,
	`status` varchar(30) NOT NULL DEFAULT 'open',
	`due_date` varchar(10),
	`repairer_id` varchar(191),
	`verified_by` varchar(191),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `workshop_orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `workshop_entries_org_idx` ON `workshop_entries` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `workshop_entries_order_idx` ON `workshop_entries` (`organisation_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `workshop_orders_org_idx` ON `workshop_orders` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `workshop_orders_asset_idx` ON `workshop_orders` (`organisation_id`,`asset_id`);