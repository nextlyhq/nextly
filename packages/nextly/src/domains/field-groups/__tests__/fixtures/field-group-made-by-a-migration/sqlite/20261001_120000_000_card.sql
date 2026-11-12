-- Migration: card
-- Field groups: card
-- Entity scope: touched
-- Generated at: 2026-10-01T12:00:00.000Z
-- Dialect: SQLite

-- UP
CREATE TABLE "comp_card" (
  "id" text PRIMARY KEY NOT NULL,
  "_parent_id" text NOT NULL,
  "_parent_table" text NOT NULL,
  "_parent_field" text NOT NULL,
  "_order" integer,
  "_component_type" text,
  "heading" text,
  "views" integer,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_comp_card_parent" ON "comp_card" ("_parent_id", "_parent_table", "_parent_field");
CREATE INDEX IF NOT EXISTS "idx_comp_card_created_at" ON "comp_card" ("created_at");

-- DOWN
DROP TABLE "comp_card";
