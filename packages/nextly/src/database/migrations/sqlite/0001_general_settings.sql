-- Migration: Create site_settings table for general application settings
-- This migration creates the site_settings singleton table.
-- Only one row ever exists with id = 'default'.

-- UP

CREATE TABLE IF NOT EXISTS "site_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"application_name" text,
	"site_url" text,
	"admin_email" text,
	"timezone" text,
	"date_format" text,
	"time_format" text,
	"updated_at" integer NOT NULL
);

-- DOWN

DROP TABLE IF EXISTS "site_settings";
