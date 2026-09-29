CREATE TABLE `domain_events` (
 `id` varchar(191) NOT NULL PRIMARY KEY,
 `organisation_id` varchar(191) NOT NULL,
 `event_type` varchar(80) NOT NULL,
 `event_version` int NOT NULL DEFAULT 1,
 `module` varchar(40) NOT NULL,
 `entity_type` varchar(40) NOT NULL,
 `entity_id` varchar(191) NOT NULL,
 `occurrence_id` varchar(191) NOT NULL,
 `actor_user_id` varchar(191) NOT NULL,
 `created_at` varchar(40) NOT NULL,
 CONSTRAINT `idx_domain_event_occurrence` UNIQUE (`organisation_id`,`event_type`,`occurrence_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_domain_events_org_time` ON `domain_events` (`organisation_id`,`created_at`,`id`);
