-- Migration: Plan 12 user management + email tables
-- Generated at: 2026-05-05T00:00:00.000Z
-- Dialect: SQLite
-- Source: SQLite was missing the equivalent of postgresql/0009 and
-- mysql/0005 — without these tables UserExtSchemaService.syncCodeFields
-- silently fails on first boot, hasMergedFields stays false, the
-- user_ext table never gets created, and `/authors/[slug]` resolves to
-- /authors/undefined for blog-template projects on SQLite. Adding the
-- three tables fixes the cascade.

-- UP

CREATE TABLE IF NOT EXISTS `user_field_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `label` text NOT NULL,
  `type` text NOT NULL,
  `required` integer NOT NULL DEFAULT 0,
  `default_value` text,
  `options` text,
  `placeholder` text,
  `description` text,
  `sort_order` integer NOT NULL DEFAULT 0,
  `source` text NOT NULL DEFAULT 'ui',
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  `updated_at` integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS `user_field_defs_name_unique_idx` ON `user_field_definitions` (`name`);
CREATE INDEX IF NOT EXISTS `user_field_defs_source_idx` ON `user_field_definitions` (`source`);
CREATE INDEX IF NOT EXISTS `user_field_defs_is_active_idx` ON `user_field_definitions` (`is_active`);
CREATE INDEX IF NOT EXISTS `user_field_defs_sort_order_idx` ON `user_field_definitions` (`sort_order`);
CREATE INDEX IF NOT EXISTS `user_field_defs_created_at_idx` ON `user_field_definitions` (`created_at`);

CREATE TABLE IF NOT EXISTS `email_providers` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `from_email` text NOT NULL,
  `from_name` text,
  `configuration` text NOT NULL,
  `is_default` integer NOT NULL DEFAULT 0,
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  `updated_at` integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS `email_providers_type_idx` ON `email_providers` (`type`);
CREATE UNIQUE INDEX IF NOT EXISTS `email_providers_default_unique_idx` ON `email_providers` (`is_default`) WHERE `is_default` = 1;
CREATE INDEX IF NOT EXISTS `email_providers_is_active_idx` ON `email_providers` (`is_active`);
CREATE INDEX IF NOT EXISTS `email_providers_created_at_idx` ON `email_providers` (`created_at`);

CREATE TABLE IF NOT EXISTS `email_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `slug` text NOT NULL UNIQUE,
  `subject` text NOT NULL,
  `html_content` text NOT NULL,
  `plain_text_content` text,
  `variables` text,
  `use_layout` integer NOT NULL DEFAULT 1,
  `is_active` integer NOT NULL DEFAULT 1,
  `provider_id` text,
  `created_at` integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  `updated_at` integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS `email_templates_is_active_idx` ON `email_templates` (`is_active`);
CREATE INDEX IF NOT EXISTS `email_templates_provider_id_idx` ON `email_templates` (`provider_id`);
CREATE INDEX IF NOT EXISTS `email_templates_created_at_idx` ON `email_templates` (`created_at`);

-- DOWN

DROP TABLE IF EXISTS `email_templates`;
DROP TABLE IF EXISTS `email_providers`;
DROP TABLE IF EXISTS `user_field_definitions`;
