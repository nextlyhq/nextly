-- Migration: notes
-- Collections: notes
-- Entity scope: touched
-- Settings: notes: added
-- Generated at: 2026-10-31T17:09:30.233Z
-- Dialect: PostgreSQL

-- UP
CREATE TABLE "dc_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "created_by" text,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "value" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_notes_slug" ON "dc_notes" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_notes_created_by" ON "dc_notes" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_notes_created_at" ON "dc_notes" ("created_at");

-- DOWN
DROP TABLE "dc_notes" CASCADE;
