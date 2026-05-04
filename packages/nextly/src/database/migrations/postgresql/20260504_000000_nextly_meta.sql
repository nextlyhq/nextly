-- Migration: nextly_meta runtime flags table
-- Generated at: 2026-05-04T00:00:00.000Z
-- Dialect: PostgreSQL
-- Source: Sub-task 2A — dashboard seeding card.
-- A small key/value/timestamp store for runtime state that doesn't belong
-- in collection schemas (first consumer: seed.completedAt / seed.skippedAt
-- flags read by the admin dashboard's SeedDemoContentCard).

-- UP

CREATE TABLE IF NOT EXISTS "nextly_meta" (
  "key"        TEXT PRIMARY KEY NOT NULL,
  "value"      JSONB,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "nextly_meta_updated_at_idx"
  ON "nextly_meta" ("updated_at");

-- DOWN

DROP TABLE IF EXISTS "nextly_meta";
