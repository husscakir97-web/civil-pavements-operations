CREATE TABLE `planning_plans` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `name` varchar(180) NOT NULL,
  `owner_user_id` varchar(191) NOT NULL,
  `access_scope` varchar(20) NOT NULL DEFAULT 'organisation',
  `estimate_id` varchar(191),
  `tender_id` varchar(191),
  `project_id` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `planning_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `planning_plans_org_idx` ON `planning_plans` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX `planning_plans_owner_idx` ON `planning_plans` (`organisation_id`,`owner_user_id`);
--> statement-breakpoint
CREATE INDEX `planning_plans_estimate_idx` ON `planning_plans` (`organisation_id`,`estimate_id`);
--> statement-breakpoint
CREATE TABLE `planning_scenarios` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `plan_id` varchar(191) NOT NULL,
  `name` varchar(180) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `based_on_scenario_id` varchar(191),
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(191),
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `planning_scenarios_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `planning_scenarios_org_idx` ON `planning_scenarios` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX `planning_scenarios_plan_idx` ON `planning_scenarios` (`organisation_id`,`plan_id`);
--> statement-breakpoint
CREATE TABLE `planning_activities` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `scenario_id` varchar(191) NOT NULL,
  `kind` varchar(20) NOT NULL DEFAULT 'activity',
  `name` varchar(180) NOT NULL,
  `notes` text,
  `sort` int NOT NULL DEFAULT 0,
  `quantity` decimal(15,3),
  `unit` varchar(20),
  `productivity` decimal(15,6),
  `productivity_unit` varchar(20),
  `duration_mode` varchar(10) NOT NULL DEFAULT 'entered',
  `duration_days` decimal(9,3),
  `hours_per_day` decimal(5,2),
  `planned_start` varchar(10),
  CONSTRAINT `planning_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `planning_activities_org_idx` ON `planning_activities` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX `planning_activities_scenario_idx` ON `planning_activities` (`organisation_id`,`scenario_id`);
--> statement-breakpoint
CREATE TABLE `planning_dependencies` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `scenario_id` varchar(191) NOT NULL,
  `predecessor_id` varchar(191) NOT NULL,
  `successor_id` varchar(191) NOT NULL,
  CONSTRAINT `planning_dependencies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `planning_dependencies_org_idx` ON `planning_dependencies` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX `planning_dependencies_scenario_idx` ON `planning_dependencies` (`organisation_id`,`scenario_id`);
--> statement-breakpoint
CREATE TABLE `planning_requirements` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `scenario_id` varchar(191) NOT NULL,
  `activity_id` varchar(191) NOT NULL,
  `kind` varchar(10) NOT NULL,
  `name` varchar(180) NOT NULL,
  `sort` int NOT NULL DEFAULT 0,
  `quantity` decimal(15,3),
  `rate` decimal(15,4),
  `rate_basis` varchar(10) NOT NULL DEFAULT 'hour',
  `resource_ref_type` varchar(10),
  `resource_ref_id` varchar(191),
  CONSTRAINT `planning_requirements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `planning_requirements_org_idx` ON `planning_requirements` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX `planning_requirements_scenario_idx` ON `planning_requirements` (`organisation_id`,`scenario_id`);
--> statement-breakpoint
CREATE TABLE `planning_cost_items` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `scenario_id` varchar(191) NOT NULL,
  `scope` varchar(10) NOT NULL,
  `activity_id` varchar(191),
  `label` varchar(180) NOT NULL,
  `amount` decimal(15,2),
  `sort` int NOT NULL DEFAULT 0,
  CONSTRAINT `planning_cost_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `planning_cost_items_org_idx` ON `planning_cost_items` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX `planning_cost_items_scenario_idx` ON `planning_cost_items` (`organisation_id`,`scenario_id`);
--> statement-breakpoint
CREATE TABLE `planning_cost_links` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `scenario_id` varchar(191) NOT NULL,
  `cost_item_id` varchar(191) NOT NULL,
  `activity_id` varchar(191) NOT NULL,
  CONSTRAINT `planning_cost_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `planning_cost_links_org_idx` ON `planning_cost_links` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX `planning_cost_links_scenario_idx` ON `planning_cost_links` (`organisation_id`,`scenario_id`);
--> statement-breakpoint
CREATE TABLE `planning_canvas_positions` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `scenario_id` varchar(191) NOT NULL,
  `activity_id` varchar(191) NOT NULL,
  `x` int NOT NULL,
  `y` int NOT NULL,
  CONSTRAINT `planning_canvas_positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `planning_canvas_positions_org_idx` ON `planning_canvas_positions` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX `planning_canvas_positions_scenario_idx` ON `planning_canvas_positions` (`organisation_id`,`scenario_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_dependencies_pair_uq` ON `planning_dependencies` (`scenario_id`,`predecessor_id`,`successor_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_canvas_positions_uq` ON `planning_canvas_positions` (`scenario_id`,`activity_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_cost_links_uq` ON `planning_cost_links` (`scenario_id`,`cost_item_id`,`activity_id`);
