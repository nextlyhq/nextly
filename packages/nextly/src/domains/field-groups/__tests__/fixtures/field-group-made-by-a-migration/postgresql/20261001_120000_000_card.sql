-- Migration: card
-- Field groups: card
-- Entity scope: touched
-- Generated at: 2026-10-01T12:00:00.000Z
-- Dialect: PostgreSQL

-- UP
CREATE TABLE "comp_card" (
  "id" text PRIMARY KEY NOT NULL,
  "_parent_id" text NOT NULL,
  "_parent_table" varchar NOT NULL,
  "_parent_field" varchar NOT NULL,
  "_order" int4,
  "_component_type" varchar,
  "heading" text,
  "views" int4,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_comp_card_parent" ON "comp_card" ("_parent_id", "_parent_table", "_parent_field");
CREATE INDEX IF NOT EXISTS "idx_comp_card_created_at" ON "comp_card" ("created_at");

-- DOWN
DROP TABLE "comp_card" CASCADE;
