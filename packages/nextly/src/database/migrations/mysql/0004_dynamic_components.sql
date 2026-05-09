-- Migration: Create dynamic_components table
-- This migration creates the dynamic_components table for storing Component metadata
-- Components are reusable field group templates that can be embedded in Collections and Singles

CREATE TABLE IF NOT EXISTS `dynamic_components` (
	`id` varchar(36) PRIMARY KEY,
	`slug` varchar(255) NOT NULL UNIQUE,
	`label` varchar(255) NOT NULL,
	`table_name` varchar(255) NOT NULL UNIQUE,
	`description` text,
	`fields` json NOT NULL,
	`admin` json,
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
CREATE INDEX `dynamic_components_source_idx` ON `dynamic_components` (`source`);
--> statement-breakpoint
CREATE INDEX `dynamic_components_migration_status_idx` ON `dynamic_components` (`migration_status`);
--> statement-breakpoint
CREATE INDEX `dynamic_components_created_by_idx` ON `dynamic_components` (`created_by`);
--> statement-breakpoint
CREATE INDEX `dynamic_components_created_at_idx` ON `dynamic_components` (`created_at`);
--> statement-breakpoint
CREATE INDEX `dynamic_components_updated_at_idx` ON `dynamic_components` (`updated_at`);
