-- Migration: rename_field
-- Collections: rtl_notes
-- Entity scope: touched
-- Settings: rtl_notes: fields.visits (added), fields.views (removed)
-- Generated at: 2026-11-24T07:57:10.202Z
-- Dialect: PostgreSQL

-- UP
ALTER TABLE "dc_rtl_notes" RENAME COLUMN "views" TO "visits";

-- DOWN
ALTER TABLE "dc_rtl_notes" RENAME COLUMN "visits" TO "views";
