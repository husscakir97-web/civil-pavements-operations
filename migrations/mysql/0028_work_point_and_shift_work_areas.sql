CREATE TABLE `project_work_points` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `project_id` varchar(191) NOT NULL,
  `lat` decimal(10,7) NOT NULL,
  `lng` decimal(10,7) NOT NULL,
  `source` varchar(20) NOT NULL DEFAULT 'project',
  `location_id` varchar(191),
  `revision` int NOT NULL DEFAULT 1,
  `confirmed_by` varchar(191),
  `confirmed_at` varchar(40) NOT NULL,
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `project_work_points_id` PRIMARY KEY(`id`),
  CONSTRAINT `project_work_points_project_uq` UNIQUE(`organisation_id`,`project_id`)
);
--> statement-breakpoint
CREATE INDEX `project_work_points_org_idx` ON `project_work_points` (`organisation_id`);
--> statement-breakpoint
CREATE TABLE `shift_work_areas` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `shift_id` varchar(191) NOT NULL,
  `work_area_id` varchar(191) NOT NULL,
  `project_id` varchar(191) NOT NULL,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `shift_work_areas_id` PRIMARY KEY(`id`),
  CONSTRAINT `shift_work_areas_pair_uq` UNIQUE(`organisation_id`,`shift_id`,`work_area_id`)
);
--> statement-breakpoint
CREATE INDEX `shift_work_areas_org_idx` ON `shift_work_areas` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX `shift_work_areas_area_idx` ON `shift_work_areas` (`organisation_id`,`work_area_id`);
