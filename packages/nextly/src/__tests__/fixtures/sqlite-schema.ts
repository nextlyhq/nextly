/**
 * Flat-namespace SQLite schema for the test fixture layer.
 *
 * Existing test fixtures (`db.ts`, `seed-helpers.ts`, `service-factory.ts`)
 * pass a `* as schema` namespace import directly to
 * `drizzle(sqlite, { schema })`. They reach a few specific tables
 * (`schema.users`, `schema.roles`, `schema.dynamicCollections`, etc.) and
 * rely on Drizzle picking up the matching `<table>Relations` so the
 * `db.query` API works.
 *
 * The legacy source — `database/schema/sqlite.ts` — was deleted in Plan A
 * Task 17. This module is a thin re-export wrapper around the canonical
 * dialect bundle at `schemas/_dialect-bundles/sqlite.ts`. We keep the
 * separate file under `__tests__/fixtures/` so the test layer can grow
 * test-only seed exports here without polluting the production bundle.
 *
 * Test code only. Production code uses `getCoreSchema(dialect)` from
 * `@nextly/schemas`.
 *
 * @module __tests__/fixtures/sqlite-schema
 * @since v0.0.3-alpha (Plan A Task 17 — replaces database/schema/sqlite.ts)
 */

export * from "../../schemas/_dialect-bundles/sqlite";
