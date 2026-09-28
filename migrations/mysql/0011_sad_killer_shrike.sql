CREATE TABLE `asset_meter_readings` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`asset_id` varchar(191) NOT NULL,
	`meter_type` varchar(20) NOT NULL,
	`reading` decimal(15,2) NOT NULL,
	`next_service` decimal(15,2) NOT NULL,
	`note` text NOT NULL,
	`actor_id` varchar(191) NOT NULL,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `asset_meter_readings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `plant` ADD `meter_type` varchar(20);--> statement-breakpoint
ALTER TABLE `plant` ADD `current_meter` decimal(15,2);--> statement-breakpoint
ALTER TABLE `plant` ADD `next_service_meter` decimal(15,2);--> statement-breakpoint
CREATE INDEX `asset_meter_readings_org_idx` ON `asset_meter_readings` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `asset_meter_readings_asset_idx` ON `asset_meter_readings` (`organisation_id`,`asset_id`);