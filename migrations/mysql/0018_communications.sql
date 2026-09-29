CREATE TABLE `communication_threads` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `context_type` varchar(40) NOT NULL,
  `context_id` varchar(191) NOT NULL,
  `project_id` varchar(191),
  `title` varchar(255) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'open',
  `created_by` varchar(191) NOT NULL,
  `created_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `communication_threads_id` PRIMARY KEY(`id`),
  CONSTRAINT `idx_communication_threads_context` UNIQUE(`organisation_id`,`context_type`,`context_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_communication_threads_project` ON `communication_threads` (`organisation_id`,`project_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `communication_messages` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `thread_id` varchar(191) NOT NULL,
  `author_user_id` varchar(191) NOT NULL,
  `parent_message_id` varchar(191),
  `body` text NOT NULL,
  `requires_ack` int NOT NULL DEFAULT 0,
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `communication_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_communication_messages_thread` ON `communication_messages` (`organisation_id`,`thread_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `communication_receipts` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `message_id` varchar(191) NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `mentioned` int NOT NULL DEFAULT 0,
  `read_at` varchar(40),
  `acknowledged_at` varchar(40),
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `communication_receipts_id` PRIMARY KEY(`id`),
  CONSTRAINT `idx_communication_receipts_user_message` UNIQUE(`organisation_id`,`message_id`,`user_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_communication_receipts_user` ON `communication_receipts` (`organisation_id`,`user_id`,`read_at`,`acknowledged_at`);
--> statement-breakpoint
CREATE TABLE `notifications` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `kind` varchar(40) NOT NULL,
  `title` varchar(255) NOT NULL,
  `body` varchar(1000) NOT NULL,
  `context_type` varchar(40),
  `context_id` varchar(191),
  `project_id` varchar(191),
  `target_area` varchar(60),
  `target_sub` varchar(60),
  `target_id` varchar(191),
  `target_tab` varchar(60),
  `read_at` varchar(40),
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_unread` ON `notifications` (`organisation_id`,`user_id`,`read_at`,`created_at`);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `in_app` int NOT NULL DEFAULT 1,
  `email` int NOT NULL DEFAULT 0,
  `sms` int NOT NULL DEFAULT 0,
  `quiet_start` varchar(5),
  `quiet_end` varchar(5),
  `timezone` varchar(80) NOT NULL DEFAULT 'Australia/Sydney',
  `updated_at` varchar(40) NOT NULL,
  CONSTRAINT `notification_preferences_id` PRIMARY KEY(`id`),
  CONSTRAINT `idx_notification_preferences_user` UNIQUE(`organisation_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `external_access_tokens` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `context_type` varchar(40) NOT NULL,
  `context_id` varchar(191) NOT NULL,
  `project_id` varchar(191),
  `recipient_name` varchar(180),
  `recipient_email` varchar(254),
  `recipient_phone` varchar(60),
  `scopes` varchar(500) NOT NULL DEFAULT 'view,acknowledge,respond',
  `expires_at` varchar(40) NOT NULL,
  `revoked_at` varchar(40),
  `last_accessed_at` varchar(40),
  `created_by` varchar(191) NOT NULL,
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `external_access_tokens_id` PRIMARY KEY(`id`),
  CONSTRAINT `idx_external_access_tokens_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE INDEX `idx_external_access_tokens_context` ON `external_access_tokens` (`organisation_id`,`context_type`,`context_id`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `external_responses` (
  `id` varchar(191) NOT NULL,
  `organisation_id` varchar(191) NOT NULL,
  `token_id` varchar(191) NOT NULL,
  `kind` varchar(30) NOT NULL,
  `payload` longtext,
  `created_at` varchar(40) NOT NULL,
  CONSTRAINT `external_responses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_external_responses_token` ON `external_responses` (`organisation_id`,`token_id`,`created_at`);
