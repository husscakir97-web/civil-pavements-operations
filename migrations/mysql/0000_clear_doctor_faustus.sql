CREATE TABLE `attachments` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `attachments_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `claim_items` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`claim_id` longtext NOT NULL,
	`docket_id` varchar(191) NOT NULL,
	`line_item` longtext NOT NULL DEFAULT (''),
	`amount` double NOT NULL DEFAULT (0),
	`created_at` longtext NOT NULL,
	CONSTRAINT `claim_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_claim_items_unique` UNIQUE(`organisation_id`,`docket_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`job_id` varchar(191) NOT NULL,
	`claim_period` varchar(191) NOT NULL,
	`status` longtext NOT NULL DEFAULT ('Draft'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `claims_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`contact_name` longtext NOT NULL DEFAULT (''),
	`email` longtext NOT NULL DEFAULT (''),
	`phone` longtext NOT NULL DEFAULT (''),
	CONSTRAINT `clients_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `commercial_records` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `commercial_records_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `cost_codes` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `cost_codes_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `crews` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `crews_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `dockets` (
	`id` varchar(191) NOT NULL,
	`docket_no` varchar(191) NOT NULL,
	`work_date` varchar(191) NOT NULL,
	`client` longtext NOT NULL DEFAULT (''),
	`project` longtext NOT NULL DEFAULT (''),
	`crew` longtext NOT NULL DEFAULT (''),
	`vehicle` longtext NOT NULL DEFAULT (''),
	`start_time` longtext NOT NULL DEFAULT (''),
	`finish_time` longtext NOT NULL DEFAULT (''),
	`break_hours` double NOT NULL DEFAULT (0),
	`labour_hours` double NOT NULL DEFAULT (0),
	`quantity` double NOT NULL DEFAULT (0),
	`quantity_unit` longtext NOT NULL DEFAULT ('t'),
	`amount` double NOT NULL DEFAULT (0),
	`po_number` longtext NOT NULL DEFAULT (''),
	`notes` longtext NOT NULL DEFAULT (''),
	`status` longtext NOT NULL DEFAULT ('review'),
	`confidence` double NOT NULL DEFAULT (0),
	`source_name` longtext NOT NULL DEFAULT (''),
	`source_key` longtext NOT NULL DEFAULT (''),
	`raw_text` longtext NOT NULL DEFAULT (''),
	`created_at` longtext NOT NULL,
	`updated_at` longtext NOT NULL,
	`organisation_id` varchar(191) NOT NULL DEFAULT ('roadworx-sydney'),
	`source_page` double,
	`source_crop` longtext NOT NULL DEFAULT ('full-page'),
	`field_confidence` longtext NOT NULL DEFAULT ('{}'),
	`line_items` longtext NOT NULL DEFAULT ('[]'),
	`links` longtext NOT NULL DEFAULT ('{}'),
	`extraction_method` longtext NOT NULL DEFAULT ('local-ocr'),
	`profile_id` longtext NOT NULL DEFAULT (''),
	CONSTRAINT `dockets_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `estimates` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `estimates_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `extraction_profiles` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`supplier` longtext NOT NULL DEFAULT (''),
	`client` longtext NOT NULL DEFAULT (''),
	`docket_type` longtext NOT NULL DEFAULT (''),
	`rules` longtext NOT NULL DEFAULT ('{}'),
	`sample_count` int NOT NULL DEFAULT (0),
	`created_at` longtext NOT NULL,
	`updated_at` longtext NOT NULL,
	CONSTRAINT `extraction_profiles_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `field_history` (
	`id` varchar(191) NOT NULL,
	`shift_id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`revision` int NOT NULL,
	`action` longtext NOT NULL,
	`reason` longtext NOT NULL,
	`actor` longtext NOT NULL,
	`snapshot` longtext NOT NULL,
	`created_at` longtext NOT NULL,
	CONSTRAINT `field_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_field_revision` UNIQUE(`shift_id`,`revision`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `field_records` (
	`shift_id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`revision` int NOT NULL,
	`status` longtext NOT NULL,
	`data` longtext NOT NULL,
	`plan` longtext NOT NULL,
	`job` longtext NOT NULL,
	`updated_at` longtext NOT NULL,
	CONSTRAINT `field_records_shift_id` PRIMARY KEY(`shift_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `ims_document_revisions` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`document_id` varchar(191) NOT NULL,
	`revision` int NOT NULL,
	`status` longtext NOT NULL,
	`snapshot` longtext NOT NULL,
	`changed_by_user_id` longtext NOT NULL,
	`change_reason` longtext NOT NULL DEFAULT (''),
	`created_at` longtext NOT NULL,
	CONSTRAINT `ims_document_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_ims_document_revisions_unique` UNIQUE(`organisation_id`,`document_id`,`revision`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `ims_documents` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`scope` varchar(191) NOT NULL DEFAULT ('organisation'),
	`job_id` varchar(191),
	`title` longtext NOT NULL,
	`document_type` longtext NOT NULL,
	`revision` int NOT NULL DEFAULT (1),
	`owner_user_id` longtext,
	`approver_user_id` longtext,
	`status` varchar(191) NOT NULL DEFAULT ('Draft'),
	`effective_date` longtext,
	`review_date` longtext,
	`expiry_date` longtext,
	`source_requirement_id` longtext,
	`storage_attachment_id` longtext,
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	`updated_at` longtext NOT NULL,
	CONSTRAINT `ims_documents_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `job_ims_items` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`job_id` varchar(191) NOT NULL,
	`title` varchar(191) NOT NULL,
	`document_type` varchar(191) NOT NULL,
	`mandatory` int NOT NULL DEFAULT (1),
	`status` longtext NOT NULL DEFAULT ('Missing'),
	`source_requirement_id` longtext,
	`linked_document_id` longtext,
	`due_date` longtext,
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	`updated_at` longtext NOT NULL,
	CONSTRAINT `job_ims_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_job_ims_items_unique` UNIQUE(`organisation_id`,`job_id`,`document_type`,`title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `opportunities_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `organisations` (
	`id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`created_at` longtext NOT NULL,
	CONSTRAINT `organisations_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `plant` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `plant_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `preparation_revisions` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`revision` int NOT NULL,
	`kind` longtext NOT NULL,
	`title` longtext NOT NULL,
	`status` longtext NOT NULL,
	`job_id` varchar(191),
	`opportunity_id` varchar(191),
	`data` longtext NOT NULL,
	`actor_id` longtext NOT NULL,
	`reason` longtext NOT NULL,
	`created_at` longtext NOT NULL,
	CONSTRAINT `idx_preparation_revision` UNIQUE(`organisation_id`,`id`,`revision`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `qa_safety_records` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `qa_safety_records_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `quote_revisions` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `quote_revisions_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `rate_libraries` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `rate_libraries_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `shifts_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `subcontractors` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `subcontractors_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `tender_requirements` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`opportunity_id` varchar(191) NOT NULL,
	`title` longtext NOT NULL,
	`requirement_type` longtext NOT NULL DEFAULT ('Project-specific'),
	`source_document` longtext NOT NULL DEFAULT (''),
	`source_page` longtext NOT NULL DEFAULT (''),
	`owner_user_id` longtext,
	`due_date` longtext,
	`status` varchar(191) NOT NULL DEFAULT ('Missing'),
	`mandatory` int NOT NULL DEFAULT (1),
	`clarification` longtext NOT NULL DEFAULT (''),
	`linked_document_id` longtext,
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	`updated_at` longtext NOT NULL,
	CONSTRAINT `tender_requirements_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`email` longtext NOT NULL,
	`name` longtext NOT NULL,
	`role` longtext NOT NULL,
	`created_at` longtext NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `variations` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `variations_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `work_packages` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `work_packages_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `workers` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`name` longtext NOT NULL,
	`status` longtext NOT NULL DEFAULT ('active'),
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	CONSTRAINT `workers_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `workflow_tasks` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`title` longtext NOT NULL,
	`status` varchar(191) NOT NULL DEFAULT ('Open'),
	`owner_user_id` longtext,
	`due_date` varchar(191),
	`entity_type` longtext NOT NULL,
	`entity_id` longtext NOT NULL,
	`metadata` longtext NOT NULL DEFAULT ('{}'),
	`created_at` longtext NOT NULL,
	`updated_at` longtext NOT NULL,
	CONSTRAINT `workflow_tasks_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `auth_account` (
	`id` varchar(191) NOT NULL,
	`account_id` varchar(191) NOT NULL,
	`provider_id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` timestamp(3),
	`refresh_token_expires_at` timestamp(3),
	`scope` text,
	`password` text,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `auth_account_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `organisation_invitations` (
	`id` varchar(191) NOT NULL,
	`organisation_id` varchar(191) NOT NULL,
	`email` varchar(254) NOT NULL,
	`role` varchar(20) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`invited_by` varchar(191) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`accepted_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `organisation_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organisation_invitations_token_hash_unique` UNIQUE(`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `auth_session` (
	`id` varchar(191) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`token` varchar(255) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` varchar(191) NOT NULL,
	CONSTRAINT `auth_session_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_session_token_unique` UNIQUE(`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `auth_user` (
	`id` varchar(191) NOT NULL,
	`name` text NOT NULL,
	`email` varchar(254) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `auth_user_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_user_email_unique` UNIQUE(`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `auth_verification` (
	`id` varchar(191) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `auth_verification_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
ALTER TABLE `auth_account` ADD CONSTRAINT `auth_account_user_id_auth_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auth_session` ADD CONSTRAINT `auth_session_user_id_auth_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_attachments_org` ON `attachments` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_org` ON `audit_events` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_claims_org_job_period` ON `claims` (`organisation_id`,`job_id`,`claim_period`);--> statement-breakpoint
CREATE INDEX `idx_clients_org` ON `clients` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_commercial_records_org` ON `commercial_records` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_cost_codes_org` ON `cost_codes` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_crews_org` ON `crews` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_dockets_organisation` ON `dockets` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_dockets_docket_no` ON `dockets` (`docket_no`);--> statement-breakpoint
CREATE INDEX `idx_dockets_work_date` ON `dockets` (`work_date`);--> statement-breakpoint
CREATE INDEX `idx_estimates_org` ON `estimates` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_extraction_profiles_org` ON `extraction_profiles` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_field_history` ON `field_history` (`organisation_id`,`shift_id`);--> statement-breakpoint
CREATE INDEX `idx_field_org` ON `field_records` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_ims_documents_org_job` ON `ims_documents` (`organisation_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `idx_ims_documents_org_scope` ON `ims_documents` (`organisation_id`,`scope`,`status`);--> statement-breakpoint
CREATE INDEX `idx_jobs_org` ON `jobs` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_opportunities_org` ON `opportunities` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_plant_org` ON `plant` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_preparation_opportunity` ON `preparation_revisions` (`organisation_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `idx_preparation_job` ON `preparation_revisions` (`organisation_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `idx_qa_safety_records_org` ON `qa_safety_records` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_quote_revisions_org` ON `quote_revisions` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_rate_libraries_org` ON `rate_libraries` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_shifts_org` ON `shifts` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_subcontractors_org` ON `subcontractors` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_suppliers_org` ON `suppliers` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_tender_requirements_org_opp` ON `tender_requirements` (`organisation_id`,`opportunity_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_users_org` ON `users` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_variations_org` ON `variations` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_work_packages_org` ON `work_packages` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_workers_org` ON `workers` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_tasks_org_status` ON `workflow_tasks` (`organisation_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `auth_account_user` ON `auth_account` (`user_id`);--> statement-breakpoint
CREATE INDEX `invitations_org` ON `organisation_invitations` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `auth_session_user` ON `auth_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_verification_identifier` ON `auth_verification` (`identifier`);