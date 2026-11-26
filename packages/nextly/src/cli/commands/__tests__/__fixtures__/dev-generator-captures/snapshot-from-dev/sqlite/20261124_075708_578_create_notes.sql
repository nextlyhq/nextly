-- Migration: create_notes
-- Collections: rtl_notes
-- Entity scope: touched
-- Settings: rtl_notes: added
-- Generated at: 2026-11-24T07:57:08.578Z
-- Dialect: SQLite

-- UP
CREATE TABLE "dc_rtl_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "slug" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_rtl_notes_slug" ON "dc_rtl_notes" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_rtl_notes_created_by" ON "dc_rtl_notes" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_rtl_notes_created_at" ON "dc_rtl_notes" ("created_at");

-- DOWN
DROP TABLE "dc_rtl_notes";
