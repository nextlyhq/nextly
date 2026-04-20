-- Migration: Add logo_url column to site_settings

-- UP

ALTER TABLE "site_settings" ADD COLUMN "logo_url" text;

-- DOWN

-- SQLite does not support DROP COLUMN in older versions; handled via table recreation if needed.
