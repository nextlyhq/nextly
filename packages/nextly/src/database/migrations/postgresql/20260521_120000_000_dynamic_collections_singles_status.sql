-- Migration: dynamic_collections_singles_status
-- Generated at: 2026-05-21T12:00:00.000Z
-- Dialect: PostgreSQL
--
-- Adds the `status` column to `dynamic_collections` and
-- `dynamic_singles`. Both tables' Drizzle schemas declare
-- `status: boolean("status").default(false).notNull()`
-- (see src/schemas/dynamic-collections/postgres.ts:140 and
-- src/schemas/dynamic-singles/postgres.ts), but no migration
-- ever created the column.
--
-- The runtime DynamicCollectionRegistryService.getCollection
-- (src/domains/dynamic-collections/services/dynamic-collection-registry-service.ts:297)
-- and the equivalent singles registry call `.select()` without
-- an explicit column list — Drizzle expands that to every
-- declared column including `status`. PostgreSQL then returns
-- `column "status" does not exist`, the adapter swallows the
-- error as `[INTERNAL_ERROR] An unexpected error occurred.`,
-- and code-first collection / single registration fails with
-- `errors: N` for every code-first entry the user defined.
-- Downstream symptom: `GET /admin/api/auth/setup-status`
-- returns 500 on a fresh DB, blocking the admin setup flow.
--
-- This is distinct from the existing `migration_status`
-- varchar column (which tracks schema-apply state, not
-- draft/published lifecycle).
--
-- The column is `NOT NULL DEFAULT false`, matching the Drizzle
-- default. Existing rows (if any — these tables are typically
-- empty on first boot) get `false` (draft).

-- UP

ALTER TABLE "dynamic_collections"
  ADD COLUMN IF NOT EXISTS "status" boolean NOT NULL DEFAULT false;

ALTER TABLE "dynamic_singles"
  ADD COLUMN IF NOT EXISTS "status" boolean NOT NULL DEFAULT false;

-- DOWN

ALTER TABLE "dynamic_collections" DROP COLUMN IF EXISTS "status";
ALTER TABLE "dynamic_singles" DROP COLUMN IF EXISTS "status";
