-- Migration: Add sidebar customization columns to site_settings

-- UP

ALTER TABLE "site_settings" ADD COLUMN "logo_url_dark" text;
ALTER TABLE "site_settings" ADD COLUMN "custom_sidebar_groups" text;
ALTER TABLE "site_settings" ADD COLUMN "plugin_placements" text;

-- DOWN

-- SQLite does not support DROP COLUMN in older versions; handled via table recreation if needed.
