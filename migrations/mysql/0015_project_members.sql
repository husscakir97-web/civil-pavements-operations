CREATE TABLE `project_members` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`project_role` varchar(30) NOT NULL,
	`active` int NOT NULL DEFAULT 1,
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `project_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_project_members_unique` UNIQUE(`organisation_id`,`project_id`,`user_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_project_members_org` ON `project_members` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_project_members_org_user` ON `project_members` (`organisation_id`,`user_id`,`active`);--> statement-breakpoint
-- Backfill: every existing project manager becomes an active project member. INSERT IGNORE on the unique (organisation, project, user) key keeps reruns duplicate-free.
INSERT IGNORE INTO `project_members` (`id`,`organisation_id`,`project_id`,`user_id`,`project_role`,`active`,`revision`,`created_by`,`created_at`,`updated_at`)
SELECT UUID(),j.`organisation_id`,j.`id`,j.`project_manager_user_id`,'project_manager',1,1,NULL,CONCAT(DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%s'),'.000Z'),CONCAT(DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%s'),'.000Z')
FROM `jobs` j JOIN `users` u ON u.`id`=j.`project_manager_user_id` AND u.`organisation_id`=j.`organisation_id`
WHERE j.`project_manager_user_id` IS NOT NULL AND j.`project_manager_user_id`<>'';
