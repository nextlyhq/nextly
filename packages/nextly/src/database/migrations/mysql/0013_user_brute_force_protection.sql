-- Migration: Custom auth schema additions
-- Adds brute-force protection columns to users and creates refresh_tokens table.
-- These were added to the Drizzle schema when custom JWT auth replaced Auth.js
-- but never got corresponding migration SQL.

-- UP

ALTER TABLE `users` ADD COLUMN `failed_login_attempts` int NOT NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN `locked_until` datetime;

CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id` varchar(191) NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `token_hash` varchar(64) NOT NULL,
  `user_agent` text,
  `ip_address` varchar(45),
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
  CONSTRAINT `refresh_tokens_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);

CREATE INDEX `refresh_tokens_token_hash_idx` ON `refresh_tokens` (`token_hash`);
CREATE INDEX `refresh_tokens_user_id_idx` ON `refresh_tokens` (`user_id`);
CREATE INDEX `refresh_tokens_expires_at_idx` ON `refresh_tokens` (`expires_at`);

-- DOWN

DROP TABLE IF EXISTS `refresh_tokens`;
ALTER TABLE `users` DROP COLUMN `locked_until`;
ALTER TABLE `users` DROP COLUMN `failed_login_attempts`;
