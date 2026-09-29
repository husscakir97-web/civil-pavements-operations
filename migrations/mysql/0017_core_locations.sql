CREATE TABLE `depots` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` varchar(160) NOT NULL,
	`location_id` varchar(191),
	`notes` text,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `depots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`owner_type` varchar(30) NOT NULL,
	`owner_id` varchar(191) NOT NULL,
	`location_type` varchar(30) NOT NULL DEFAULT 'site',
	`label` varchar(255),
	`formatted_address` varchar(500),
	`address_line1` varchar(255),
	`address_line2` varchar(255),
	`locality` varchar(120),
	`state` varchar(60),
	`postcode` varchar(20),
	`country` varchar(2),
	`provider` varchar(20),
	`provider_place_id` varchar(255),
	`precision` varchar(30),
	`geocoded_lat` decimal(10,7),
	`geocoded_lng` decimal(10,7),
	`pin_lat` decimal(10,7),
	`pin_lng` decimal(10,7),
	`pin_adjusted` int NOT NULL DEFAULT 0,
	`pin_address` varchar(500),
	`source` varchar(20) NOT NULL DEFAULT 'manual',
	`geocoded_at` varchar(40),
	`reverse_geocoded_at` varchar(40),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` varchar(191),
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `locations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `location_id` varchar(191);--> statement-breakpoint
ALTER TABLE `shifts` ADD `location_id` varchar(191);--> statement-breakpoint
ALTER TABLE `client_sites` ADD `location_id` varchar(191);--> statement-breakpoint
ALTER TABLE `hseq_incidents` ADD `location_id` varchar(191);--> statement-breakpoint
ALTER TABLE `hseq_incidents` ADD `location_description` varchar(500);--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `registered_location_id` varchar(191);--> statement-breakpoint
ALTER TABLE `organisation_profiles` ADD `operating_location_id` varchar(191);--> statement-breakpoint
CREATE INDEX `idx_depots_org` ON `depots` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_locations_org` ON `locations` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_locations_org_owner` ON `locations` (`organisation_id`,`owner_type`,`owner_id`);