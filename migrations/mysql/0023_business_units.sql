CREATE TABLE `business_units` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `name` varchar(120) NOT NULL,
  `code` varchar(20) NOT NULL,
  `description` text,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `is_default` tinyint NOT NULL DEFAULT 0,
  `sort_order` int NOT NULL DEFAULT 0,
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  `archived_at` varchar(40),
  CONSTRAINT `business_units_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_business_units_code` UNIQUE(`organisation_id`,`code`)
);
--> statement-breakpoint
CREATE INDEX `idx_business_units_org` ON `business_units` (`organisation_id`,`status`);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `business_unit_id` varchar(191);
--> statement-breakpoint
ALTER TABLE `estimates` ADD `business_unit_id` varchar(191);
--> statement-breakpoint
ALTER TABLE `tenders` ADD `business_unit_id` varchar(191);
--> statement-breakpoint
ALTER TABLE `shifts` ADD `business_unit_id` varchar(191);
--> statement-breakpoint
CREATE INDEX `idx_jobs_business_unit` ON `jobs` (`organisation_id`,`business_unit_id`);
--> statement-breakpoint
CREATE INDEX `idx_estimates_business_unit` ON `estimates` (`organisation_id`,`business_unit_id`);
--> statement-breakpoint
CREATE INDEX `idx_tenders_business_unit` ON `tenders` (`organisation_id`,`business_unit_id`);
--> statement-breakpoint
CREATE INDEX `idx_shifts_business_unit` ON `shifts` (`organisation_id`,`business_unit_id`);
--> statement-breakpoint
-- BACKFILL (deterministic and idempotent; scripts/backfill-business-units.mjs re-runs everything from here)
INSERT INTO `business_units` (`id`,`organisation_id`,`name`,`code`,`description`,`status`,`is_default`,`sort_order`,`revision`,`created_at`,`updated_at`)
SELECT CONCAT('bu_default_',o.`id`),o.`id`,'General','GEN','Default division. Rename it or add more divisions in Admin.','active',1,0,1,CONCAT(DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.'),LPAD(FLOOR(MICROSECOND(UTC_TIMESTAMP(3))/1000),3,'0'),'Z'),CONCAT(DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.'),LPAD(FLOOR(MICROSECOND(UTC_TIMESTAMP(3))/1000),3,'0'),'Z')
FROM `organisations` o WHERE NOT EXISTS (SELECT 1 FROM `business_units` b WHERE b.`organisation_id`=o.`id` AND b.`is_default`=1);
--> statement-breakpoint
UPDATE `jobs` SET `business_unit_id`=CONCAT('bu_default_',`organisation_id`) WHERE `business_unit_id` IS NULL AND EXISTS (SELECT 1 FROM `business_units` b WHERE b.`id`=CONCAT('bu_default_',`jobs`.`organisation_id`));
--> statement-breakpoint
UPDATE `estimates` SET `business_unit_id`=CONCAT('bu_default_',`organisation_id`) WHERE `business_unit_id` IS NULL AND EXISTS (SELECT 1 FROM `business_units` b WHERE b.`id`=CONCAT('bu_default_',`estimates`.`organisation_id`));
--> statement-breakpoint
UPDATE `tenders` SET `business_unit_id`=CONCAT('bu_default_',`organisation_id`) WHERE `business_unit_id` IS NULL AND EXISTS (SELECT 1 FROM `business_units` b WHERE b.`id`=CONCAT('bu_default_',`tenders`.`organisation_id`));
--> statement-breakpoint
UPDATE `shifts` SET `business_unit_id`=(SELECT j.`business_unit_id` FROM `jobs` j WHERE j.`organisation_id`=`shifts`.`organisation_id` AND j.`id`=`shifts`.`project_id`) WHERE `business_unit_id` IS NULL AND `project_id` IS NOT NULL;
