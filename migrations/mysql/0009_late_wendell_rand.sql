CREATE TABLE `program_activities` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`name` varchar(180) NOT NULL,
	`start_date` varchar(10) NOT NULL,
	`duration_days` int NOT NULL,
	`predecessor_id` varchar(191),
	`responsible` varchar(180),
	`work_package` varchar(180),
	`resource_requirement` text,
	`planned_quantity` decimal(15,2),
	`quantity_unit` varchar(40),
	`production_per_day` decimal(15,2),
	`status` varchar(30) NOT NULL DEFAULT 'planned',
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `program_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `program_activities_org_idx` ON `program_activities` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `program_activities_project_idx` ON `program_activities` (`organisation_id`,`project_id`);