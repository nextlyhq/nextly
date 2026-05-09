-- Migration: Create activity_log table for Dashboard Activity Feed (Plan 16)
-- This migration creates the activity_log table that records create/update/delete
-- actions across all collections for the dashboard activity feed.

-- UP

CREATE TABLE IF NOT EXISTS `activity_log` (
	`id` varchar(191) NOT NULL PRIMARY KEY,
	`user_id` varchar(191) NOT NULL,
	`user_name` varchar(255) NOT NULL,
	`user_email` varchar(255) NOT NULL,
	`action` varchar(10) NOT NULL,
	`collection` varchar(255) NOT NULL,
	`entry_id` varchar(191),
	`entry_title` text,
	`metadata` text,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `activity_log_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_activity_log_created_at` ON `activity_log` (`created_at`);
CREATE INDEX `idx_activity_log_collection` ON `activity_log` (`collection`, `created_at`);
CREATE INDEX `idx_activity_log_user_id` ON `activity_log` (`user_id`, `created_at`);

-- DOWN

DROP INDEX `idx_activity_log_user_id` ON `activity_log`;
DROP INDEX `idx_activity_log_collection` ON `activity_log`;
DROP INDEX `idx_activity_log_created_at` ON `activity_log`;
DROP TABLE IF EXISTS `activity_log`;
