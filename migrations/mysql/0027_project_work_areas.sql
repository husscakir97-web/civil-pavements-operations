CREATE TABLE `project_work_areas` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `project_id` varchar(191) NOT NULL,
  `name` varchar(160) NOT NULL,
  `kind` varchar(20) NOT NULL DEFAULT 'work_area',
  `discipline` varchar(30) NOT NULL DEFAULT 'other',
  `delivery` varchar(20) NOT NULL DEFAULT 'own',
  `contractor_label` varchar(160),
  `sequence` int,
  `notes` text,
  `geometry` longtext NOT NULL,
  `vertex_count` int NOT NULL,
  `area_m2` double NOT NULL,
  `min_lat` decimal(10,7) NOT NULL,
  `max_lat` decimal(10,7) NOT NULL,
  `min_lng` decimal(10,7) NOT NULL,
  `max_lng` decimal(10,7) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `updated_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  `archived_at` varchar(40),
  `archived_by` varchar(191),
  CONSTRAINT `project_work_areas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `project_work_areas_org_idx` ON `project_work_areas` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX `project_work_areas_project_idx` ON `project_work_areas` (`organisation_id`,`project_id`,`status`);
