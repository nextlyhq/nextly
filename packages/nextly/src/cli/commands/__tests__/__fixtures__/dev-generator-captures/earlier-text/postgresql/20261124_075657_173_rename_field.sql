-- Migration: rename_field
-- Collections: rtl_notes
-- Entity scope: touched
-- Settings: rtl_notes: fields.headline (added), fields.heading (removed)
-- Generated at: 2026-11-24T07:56:57.173Z
-- Dialect: PostgreSQL

-- UP
ALTER TABLE "dc_rtl_notes" RENAME COLUMN "heading" TO "headline";

-- DOWN
ALTER TABLE "dc_rtl_notes" RENAME COLUMN "headline" TO "heading";
