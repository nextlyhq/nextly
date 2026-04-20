-- Migration: Custom auth schema additions
-- Adds brute-force protection columns to users and creates refresh_tokens table.
-- These were added to the Drizzle schema when custom JWT auth replaced Auth.js
-- but never got corresponding migration SQL.

-- UP

ALTER TABLE `users` ADD COLUMN `failed_login_attempts` integer NOT NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN `locked_until` integer;

CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `token_hash` text NOT NULL,
  `user_agent` text,
  `ip_address` text,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `refresh_tokens_token_hash_idx` ON `refresh_tokens` (`token_hash`);
CREATE INDEX IF NOT EXISTS `refresh_tokens_user_id_idx` ON `refresh_tokens` (`user_id`);
CREATE INDEX IF NOT EXISTS `refresh_tokens_expires_at_idx` ON `refresh_tokens` (`expires_at`);

-- DOWN

DROP TABLE IF EXISTS `refresh_tokens`;
ALTER TABLE `users` DROP COLUMN `locked_until`;
ALTER TABLE `users` DROP COLUMN `failed_login_attempts`;
