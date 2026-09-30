ALTER TABLE `workshop_orders` ADD `source_type` varchar(30);
--> statement-breakpoint
ALTER TABLE `workshop_orders` ADD `source_id` varchar(191);
--> statement-breakpoint
ALTER TABLE `workshop_orders` ADD `source_field` varchar(64);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workshop_orders_source` ON `workshop_orders` (`organisation_id`,`source_type`,`source_id`,`source_field`);
