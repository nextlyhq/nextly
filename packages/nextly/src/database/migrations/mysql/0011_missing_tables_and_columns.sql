-- Migration 0011: Add missing tables and columns to bring MySQL schema up to date.
--
-- This migration fills gaps that existed because the MySQL base migration
-- (0000_eager_sentry.sql) was generated from an older Drizzle schema snapshot
-- that predated dynamic_collections and the users.is_active/created_at/updated_at
-- columns. PostgreSQL didn't have this gap because pushSchema() worked there
-- and created all tables from the live schema definition.
--
-- See findings/task-2-mysql-code-first-migration-gaps.md for the investigation.

-- 1. Add missing columns to `users` table
ALTER TABLE `users` ADD COLUMN `is_active` boolean NOT NULL DEFAULT false;
ALTER TABLE `users` ADD COLUMN `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `users` ADD COLUMN `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- 2. Create `dynamic_collections` table (matches the Drizzle schema in mysql.ts)
CREATE TABLE IF NOT EXISTS `dynamic_collections` (
  `id` varchar(191) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `table_name` varchar(255) NOT NULL,
  `description` text,
  `labels` json NOT NULL,
  `fields` json NOT NULL,
  `timestamps` boolean NOT NULL DEFAULT true,
  `admin` json,
  `source` varchar(20) NOT NULL DEFAULT 'ui',
  `locked` boolean NOT NULL DEFAULT false,
  `config_path` varchar(500),
  `schema_hash` varchar(64) NOT NULL,
  `schema_version` int NOT NULL DEFAULT 1,
  `migration_status` varchar(20) NOT NULL DEFAULT 'pending',
  `last_migration_id` varchar(100),
  `access_rules` json,
  `hooks` json,
  `created_by` varchar(191),
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dynamic_collections_id` PRIMARY KEY(`id`),
  CONSTRAINT `dynamic_collections_slug_unique` UNIQUE(`slug`),
  CONSTRAINT `dynamic_collections_table_name_unique` UNIQUE(`table_name`)
);

CREATE INDEX `dynamic_collections_source_idx` ON `dynamic_collections` (`source`);
CREATE INDEX `dynamic_collections_created_at_idx` ON `dynamic_collections` (`created_at`);
CREATE INDEX `dynamic_collections_updated_at_idx` ON `dynamic_collections` (`updated_at`);

-- 3. Create `system_migrations` tracking table if it doesn't exist
-- (this table tracks which migrations have been applied)
CREATE TABLE IF NOT EXISTS `system_migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `run_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `system_migrations_id` PRIMARY KEY(`id`)
);
