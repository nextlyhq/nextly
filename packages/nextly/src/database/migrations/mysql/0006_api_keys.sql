-- Migration: Create api_keys table for API Key Authentication (Plan 14)
-- This migration creates the api_keys table required for programmatic API access
-- using long-lived secret keys with SHA-256 hashed storage.

-- UP

CREATE TABLE IF NOT EXISTS `api_keys` (
	`id` varchar(191) NOT NULL PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`description` text,
	`key_hash` varchar(64) NOT NULL,
	`key_prefix` varchar(16) NOT NULL,
	`token_type` varchar(20) NOT NULL,
	`role_id` varchar(191),
	`user_id` varchar(191) NOT NULL,
	`expires_at` datetime,
	`last_used_at` datetime,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `api_keys_role_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE SET NULL,
	CONSTRAINT `api_keys_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);
CREATE INDEX `api_keys_user_id_idx` ON `api_keys` (`user_id`);
CREATE INDEX `api_keys_role_id_idx` ON `api_keys` (`role_id`);
CREATE INDEX `api_keys_is_active_expires_at_idx` ON `api_keys` (`is_active`, `expires_at`);

-- DOWN

DROP INDEX `api_keys_is_active_expires_at_idx` ON `api_keys`;
DROP INDEX `api_keys_role_id_idx` ON `api_keys`;
DROP INDEX `api_keys_user_id_idx` ON `api_keys`;
DROP INDEX `api_keys_key_hash_unique` ON `api_keys`;
DROP TABLE IF EXISTS `api_keys`;
