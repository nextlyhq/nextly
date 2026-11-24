-- Migration: notes
-- Collections: notes
-- Entity scope: touched
-- Settings: notes: added
-- Generated at: 2026-11-22T06:16:13.140Z
-- Dialect: PostgreSQL

-- UP
CREATE TABLE "dc_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "created_by" text,
  "_revision" int4 NOT NULL DEFAULT 1,
  "_changed_by_kind" varchar,
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar,
  "_changed_at" timestamp,
  "title" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_dc_notes_created_by" ON "dc_notes" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_notes_created_at" ON "dc_notes" ("created_at");

-- DOWN
DROP TABLE "dc_notes" CASCADE;
