CREATE TABLE `accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`type` varchar(191) NOT NULL,
	`provider` varchar(191) NOT NULL,
	`provider_account_id` varchar(191) NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` int,
	`token_type` varchar(191),
	`scope` text,
	`id_token` text,
	`session_state` varchar(255),
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `accounts_provider_providerAccountId_unique` UNIQUE(`provider`,`provider_account_id`)
);
--> statement-breakpoint
CREATE TABLE `content_schema_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`op` varchar(191) NOT NULL,
	`table_name` varchar(255) NOT NULL,
	`sql` varchar(1024) NOT NULL,
	`meta` json,
	`created_at` datetime NOT NULL DEFAULT '2025-11-15 08:28:18.841',
	CONSTRAINT `content_schema_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_verification_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`expires` datetime NOT NULL,
	`created_at` datetime NOT NULL DEFAULT '2025-11-15 08:28:18.841',
	CONSTRAINT `email_verification_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `evt_identifier_token_hash_unique` UNIQUE(`identifier`,`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `example_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255),
	CONSTRAINT `example_users_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`expires` datetime NOT NULL,
	`used_at` datetime,
	`created_at` datetime NOT NULL DEFAULT '2025-11-15 08:28:18.841',
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `prt_identifier_token_hash_unique` UNIQUE(`identifier`,`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` varchar(191) NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`action` varchar(50) NOT NULL,
	`resource` varchar(50) NOT NULL,
	`description` varchar(255),
	`created_at` datetime NOT NULL DEFAULT '2025-11-15 08:28:18.841',
	`updated_at` datetime NOT NULL DEFAULT '2025-11-15 08:28:18.841',
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `permissions_action_resource_unique` UNIQUE(`action`,`resource`),
	CONSTRAINT `permissions_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `role_inherits` (
	`id` varchar(191) NOT NULL,
	`parent_role_id` varchar(191) NOT NULL,
	`child_role_id` varchar(191) NOT NULL,
	CONSTRAINT `role_inherits_id` PRIMARY KEY(`id`),
	CONSTRAINT `role_inherits_parent_child_unique` UNIQUE(`parent_role_id`,`child_role_id`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` varchar(191) NOT NULL,
	`role_id` varchar(191) NOT NULL,
	`permission_id` varchar(191) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT '2025-11-15 08:28:18.841',
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `role_permissions_role_permission_unique` UNIQUE(`role_id`,`permission_id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` varchar(191) NOT NULL,
	`name` varchar(50) NOT NULL,
	`slug` varchar(50) NOT NULL,
	`description` varchar(255),
	`level` int NOT NULL DEFAULT 0,
	`is_system` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT '2025-11-15 08:28:18.841',
	`updated_at` datetime NOT NULL DEFAULT '2025-11-15 08:28:18.841',
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_name_unique` UNIQUE(`name`),
	CONSTRAINT `roles_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_token` varchar(255) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`expires` datetime NOT NULL,
	CONSTRAINT `sessions_session_token` PRIMARY KEY(`session_token`)
);
--> statement-breakpoint
CREATE TABLE `system_migrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`run_at` datetime NOT NULL DEFAULT '2025-11-15 08:28:18.841',
	CONSTRAINT `system_migrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_permission_cache` (
	`id` varchar(255) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`action` varchar(50) NOT NULL,
	`resource` varchar(100) NOT NULL,
	`has_permission` int NOT NULL,
	`role_ids` json NOT NULL,
	`expires_at` datetime NOT NULL,
	`created_at` datetime NOT NULL DEFAULT '2025-11-15 08:28:18.841',
	CONSTRAINT `user_permission_cache_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`role_id` varchar(191) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT '2025-11-15 08:28:18.841',
	`expires_at` datetime,
	CONSTRAINT `user_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_roles_user_role_unique` UNIQUE(`user_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(191) NOT NULL,
	`name` varchar(255),
	`email` varchar(255) NOT NULL,
	`email_verified` datetime,
	`password_updated_at` datetime,
	`image` varchar(255),
	`password_hash` varchar(255),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verification_tokens` (
	`identifier` varchar(191) NOT NULL,
	`token` varchar(191) NOT NULL,
	`expires` datetime NOT NULL,
	CONSTRAINT `verification_tokens_identifier_token_pk` UNIQUE(`identifier`,`token`)
);
--> statement-breakpoint
CREATE INDEX `accounts_user_id_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `content_schema_events_created_at_idx` ON `content_schema_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `content_schema_events_table_name_idx` ON `content_schema_events` (`table_name`);--> statement-breakpoint
CREATE INDEX `evt_expires_idx` ON `email_verification_tokens` (`expires`);--> statement-breakpoint
CREATE INDEX `prt_expires_idx` ON `password_reset_tokens` (`expires`);--> statement-breakpoint
CREATE INDEX `prt_used_at_idx` ON `password_reset_tokens` (`used_at`);--> statement-breakpoint
CREATE INDEX `permissions_resource_idx` ON `permissions` (`resource`);--> statement-breakpoint
CREATE INDEX `permissions_action_idx` ON `permissions` (`action`);--> statement-breakpoint
CREATE INDEX `role_inherits_child_idx` ON `role_inherits` (`child_role_id`);--> statement-breakpoint
CREATE INDEX `role_inherits_parent_idx` ON `role_inherits` (`parent_role_id`);--> statement-breakpoint
CREATE INDEX `role_permissions_role_id_idx` ON `role_permissions` (`role_id`);--> statement-breakpoint
CREATE INDEX `roles_level_idx` ON `roles` (`level`);--> statement-breakpoint
CREATE INDEX `roles_is_system_idx` ON `roles` (`is_system`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `upc_user_id_idx` ON `user_permission_cache` (`user_id`);--> statement-breakpoint
CREATE INDEX `upc_expires_at_idx` ON `user_permission_cache` (`expires_at`);--> statement-breakpoint
CREATE INDEX `upc_user_action_resource_idx` ON `user_permission_cache` (`user_id`,`action`,`resource`);--> statement-breakpoint
CREATE INDEX `user_roles_user_id_idx` ON `user_roles` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_roles_expires_at_idx` ON `user_roles` (`expires_at`);--> statement-breakpoint
CREATE INDEX `verification_tokens_token_idx` ON `verification_tokens` (`token`);