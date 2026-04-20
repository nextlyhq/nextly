-- Migration: Create Plan 12 system tables
-- This migration creates the user_field_definitions, email_providers, and email_templates
-- tables required by the User Management & Extendable User Schema feature (Plan 12).

-- ============================================================
-- user_field_definitions
-- Stores metadata for custom user fields that extend the base user model.
-- Fields can be sourced from defineConfig() (code) or admin Settings UI (ui).
-- ============================================================

CREATE TABLE IF NOT EXISTS `user_field_definitions` (
	`id` varchar(36) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`label` varchar(255) NOT NULL,
	`type` varchar(50) NOT NULL,
	`required` boolean NOT NULL DEFAULT false,
	`default_value` varchar(255),
	`options` json,
	`placeholder` varchar(255),
	`description` text,
	`sort_order` int NOT NULL DEFAULT 0,
	`source` varchar(10) NOT NULL DEFAULT 'ui',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	UNIQUE KEY `user_field_defs_name_unique_idx` (`name`)
);
--> statement-breakpoint

CREATE INDEX `user_field_defs_source_idx` ON `user_field_definitions` (`source`);
--> statement-breakpoint
CREATE INDEX `user_field_defs_is_active_idx` ON `user_field_definitions` (`is_active`);
--> statement-breakpoint
CREATE INDEX `user_field_defs_sort_order_idx` ON `user_field_definitions` (`sort_order`);
--> statement-breakpoint
CREATE INDEX `user_field_defs_created_at_idx` ON `user_field_definitions` (`created_at`);
--> statement-breakpoint

-- ============================================================
-- email_providers
-- Stores email provider configurations (SMTP, Resend, SendLayer)
-- managed via the admin Settings UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS `email_providers` (
	`id` varchar(36) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`type` varchar(50) NOT NULL,
	`from_email` varchar(255) NOT NULL,
	`from_name` varchar(255),
	`configuration` json NOT NULL,
	`is_default` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
--> statement-breakpoint

CREATE INDEX `email_providers_type_idx` ON `email_providers` (`type`);
--> statement-breakpoint
CREATE INDEX `email_providers_is_active_idx` ON `email_providers` (`is_active`);
--> statement-breakpoint
CREATE INDEX `email_providers_created_at_idx` ON `email_providers` (`created_at`);
--> statement-breakpoint

-- ============================================================
-- email_templates
-- Stores email templates with {{variable}} interpolation support,
-- managed via the admin Settings UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS `email_templates` (
	`id` varchar(36) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL UNIQUE,
	`subject` text NOT NULL,
	`html_content` text NOT NULL,
	`plain_text_content` text,
	`variables` json,
	`use_layout` boolean NOT NULL DEFAULT true,
	`is_active` boolean NOT NULL DEFAULT true,
	`provider_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
--> statement-breakpoint

CREATE INDEX `email_templates_is_active_idx` ON `email_templates` (`is_active`);
--> statement-breakpoint
CREATE INDEX `email_templates_provider_id_idx` ON `email_templates` (`provider_id`);
--> statement-breakpoint
CREATE INDEX `email_templates_created_at_idx` ON `email_templates` (`created_at`);
