ALTER TABLE `plant` ADD `next_service_date` varchar(10);
--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `timezone` varchar(80);
--> statement-breakpoint
ALTER TABLE `asset_meter_readings` MODIFY `next_service` decimal(15,2) NULL;
--> statement-breakpoint
CREATE TABLE `asset_service_events` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `asset_id` varchar(191) NOT NULL,
  `kind` varchar(20) NOT NULL,
  `actor_id` varchar(191) NOT NULL,
  `performed_on` varchar(10),
  `recorded_at` varchar(40) NOT NULL,
  `meter_type` varchar(20),
  `meter_reading` decimal(15,2),
  `previous_next_service_meter` decimal(15,2),
  `previous_next_service_date` varchar(10),
  `new_next_service_meter` decimal(15,2),
  `new_next_service_date` varchar(10),
  `note` text,
  `reason` text,
  `asset_revision` int NOT NULL,
  CONSTRAINT `asset_service_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `asset_service_events_org_idx` ON `asset_service_events` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX `asset_service_events_asset_idx` ON `asset_service_events` (`organisation_id`,`asset_id`,`recorded_at`);
