ALTER TABLE `program_activities` ADD `productive_hours_per_day` decimal(6,2);
--> statement-breakpoint
ALTER TABLE `program_activities` ADD `direct_cost_rate` decimal(15,2);
--> statement-breakpoint
ALTER TABLE `program_activities` ADD `cost_rate_basis` varchar(10) DEFAULT 'hour' NOT NULL;
--> statement-breakpoint
ALTER TABLE `program_activities` ADD `source_estimate_revision_id` varchar(191);
--> statement-breakpoint
ALTER TABLE `program_activities` ADD `source_estimate_item_id` varchar(191);
