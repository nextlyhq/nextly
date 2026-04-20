-- Migration: Create dynamic_singles table
-- This migration creates the dynamic_singles table for storing Singles (Globals) metadata
-- Singles are single-document entities for site-wide configuration (site settings, navigation, etc.)

CREATE TABLE IF NOT EXISTS `dynamic_singles` (
	`id` varchar(36) PRIMARY KEY,
	`slug` varchar(255) NOT NULL UNIQUE,
	`label` varchar(255) NOT NULL,
	`table_name` varchar(255) NOT NULL UNIQUE,
	`description` text,
	`fields` json NOT NULL,
	`admin` json,
	`access_rules` json,
	`source` varchar(20) NOT NULL DEFAULT 'ui',
	`locked` boolean NOT NULL DEFAULT false,
	`config_path` varchar(500),
	`schema_hash` varchar(64) NOT NULL,
	`schema_version` int NOT NULL DEFAULT 1,
	`migration_status` varchar(20) NOT NULL DEFAULT 'pending',
	`last_migration_id` varchar(36),
	`created_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
--> statement-breakpoint

-- Create indexes for query performance
CREATE INDEX `dynamic_singles_source_idx` ON `dynamic_singles` (`source`);
--> statement-breakpoint
CREATE INDEX `dynamic_singles_migration_status_idx` ON `dynamic_singles` (`migration_status`);
--> statement-breakpoint
CREATE INDEX `dynamic_singles_created_by_idx` ON `dynamic_singles` (`created_by`);
--> statement-breakpoint
CREATE INDEX `dynamic_singles_created_at_idx` ON `dynamic_singles` (`created_at`);
--> statement-breakpoint
CREATE INDEX `dynamic_singles_updated_at_idx` ON `dynamic_singles` (`updated_at`);
