CREATE TABLE `preparation_revisions` (
	`id` text NOT NULL,
	`organisation_id` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`job_id` text,
	`opportunity_id` text,
	`data` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_preparation_revision` ON `preparation_revisions` (`organisation_id`,`id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_preparation_job` ON `preparation_revisions` (`organisation_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `idx_preparation_opportunity` ON `preparation_revisions` (`organisation_id`,`opportunity_id`);