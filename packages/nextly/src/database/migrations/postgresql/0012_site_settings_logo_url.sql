-- Migration: Add logo_url column to site_settings

-- UP

ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS "logo_url" varchar(2048);

-- DOWN

ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "logo_url";
