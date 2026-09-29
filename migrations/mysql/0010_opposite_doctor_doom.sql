CREATE TABLE `shift_requirements` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`shift_id` varchar(191) NOT NULL,
	`category` varchar(40) NOT NULL,
	`role` varchar(100) NOT NULL,
	`quantity` int NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `shift_requirements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `shift_requirements_org_idx` ON `shift_requirements` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `shift_requirements_shift_idx` ON `shift_requirements` (`organisation_id`,`shift_id`);