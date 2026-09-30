ALTER TABLE `workshop_orders` ADD `source_type` varchar(30);
--> statement-breakpoint
ALTER TABLE `workshop_orders` ADD `source_id` varchar(191);
--> statement-breakpoint
ALTER TABLE `workshop_orders` ADD `source_field` varchar(64);
--> statement-breakpoint
ALTER TABLE `workshop_orders` ADD `source_amendment_sequence` int;
--> statement-breakpoint
ALTER TABLE `workshop_orders` ADD `source_context_type` varchar(40);
--> statement-breakpoint
ALTER TABLE `workshop_orders` ADD `source_context_id` varchar(191);
--> statement-breakpoint
ALTER TABLE `workshop_orders` ADD `source_project_id` varchar(191);
--> statement-breakpoint
CREATE INDEX `idx_workshop_orders_source` ON `workshop_orders` (`organisation_id`,`source_type`,`source_id`,`source_field`);
