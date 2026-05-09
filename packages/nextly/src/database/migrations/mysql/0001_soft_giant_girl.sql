CREATE TABLE `field_permissions` (
	`id` varchar(255) NOT NULL,
	`role_id` varchar(191) NOT NULL,
	`collection_slug` varchar(100) NOT NULL,
	`field_path` varchar(255) NOT NULL,
	`action` varchar(10) NOT NULL,
	`condition` json,
	`created_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.222',
	`updated_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.222',
	CONSTRAINT `field_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `field_permissions_role_collection_field_unique` UNIQUE(`role_id`,`collection_slug`,`field_path`)
);
--> statement-breakpoint
ALTER TABLE `content_schema_events` MODIFY COLUMN `created_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.221';--> statement-breakpoint
ALTER TABLE `email_verification_tokens` MODIFY COLUMN `created_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.222';--> statement-breakpoint
ALTER TABLE `password_reset_tokens` MODIFY COLUMN `created_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.222';--> statement-breakpoint
ALTER TABLE `permissions` MODIFY COLUMN `created_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.222';--> statement-breakpoint
ALTER TABLE `permissions` MODIFY COLUMN `updated_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.222';--> statement-breakpoint
ALTER TABLE `role_permissions` MODIFY COLUMN `created_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.222';--> statement-breakpoint
ALTER TABLE `roles` MODIFY COLUMN `created_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.222';--> statement-breakpoint
ALTER TABLE `roles` MODIFY COLUMN `updated_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.222';--> statement-breakpoint
ALTER TABLE `system_migrations` MODIFY COLUMN `run_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.221';--> statement-breakpoint
ALTER TABLE `user_permission_cache` MODIFY COLUMN `created_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.222';--> statement-breakpoint
ALTER TABLE `user_roles` MODIFY COLUMN `created_at` datetime NOT NULL DEFAULT '2025-11-15 11:30:23.222';--> statement-breakpoint
CREATE INDEX `field_permissions_role_id_idx` ON `field_permissions` (`role_id`);--> statement-breakpoint
CREATE INDEX `field_permissions_collection_idx` ON `field_permissions` (`collection_slug`);--> statement-breakpoint
CREATE INDEX `field_permissions_lookup_idx` ON `field_permissions` (`role_id`,`collection_slug`,`field_path`);