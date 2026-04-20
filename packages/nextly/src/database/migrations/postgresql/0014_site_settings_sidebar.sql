-- Migration: Add sidebar customization columns to site_settings

-- UP

ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS "logo_url_dark" varchar(2048);
ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS "custom_sidebar_groups" text;
ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS "plugin_placements" text;

-- DOWN

ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "plugin_placements";
ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "custom_sidebar_groups";
ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "logo_url_dark";
