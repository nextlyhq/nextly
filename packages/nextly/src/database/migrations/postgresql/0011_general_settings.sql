-- Migration: Create site_settings table for general application settings
-- This migration creates the site_settings singleton table.
-- Only one row ever exists with id = 'default'.

-- UP

CREATE TABLE IF NOT EXISTS "site_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"application_name" varchar(255),
	"site_url" varchar(2048),
	"admin_email" varchar(255),
	"timezone" varchar(100),
	"date_format" varchar(50),
	"time_format" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- DOWN

DROP TABLE IF EXISTS "site_settings";
