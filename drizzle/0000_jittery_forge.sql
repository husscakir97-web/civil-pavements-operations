CREATE TABLE `dockets` (
	`id` text PRIMARY KEY NOT NULL,
	`docket_no` text NOT NULL,
	`work_date` text NOT NULL,
	`client` text DEFAULT '' NOT NULL,
	`project` text DEFAULT '' NOT NULL,
	`crew` text DEFAULT '' NOT NULL,
	`vehicle` text DEFAULT '' NOT NULL,
	`start_time` text DEFAULT '' NOT NULL,
	`finish_time` text DEFAULT '' NOT NULL,
	`break_hours` real DEFAULT 0 NOT NULL,
	`labour_hours` real DEFAULT 0 NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`quantity_unit` text DEFAULT 't' NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`po_number` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`source_name` text DEFAULT '' NOT NULL,
	`source_key` text DEFAULT '' NOT NULL,
	`raw_text` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dockets_work_date` ON `dockets` (`work_date`);--> statement-breakpoint
CREATE INDEX `idx_dockets_docket_no` ON `dockets` (`docket_no`);--> statement-breakpoint
PRAGMA optimize;
