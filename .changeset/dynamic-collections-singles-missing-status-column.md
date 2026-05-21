---
"nextly": patch
---

Fix `dynamic_collections` and `dynamic_singles` registration silently failing on PostgreSQL + MySQL with a swallowed `[INTERNAL_ERROR] An unexpected error occurred.`, blocking code-first collection/single registration and surfacing as a 500 on `GET /admin/api/auth/setup-status` on a fresh database.

**Root cause.** Both tables' Drizzle schemas declare `status: boolean("status").default(false).notNull()` (see [`src/schemas/dynamic-collections/postgres.ts`](packages/nextly/src/schemas/dynamic-collections/postgres.ts) line 140 and [`src/schemas/dynamic-singles/postgres.ts`](packages/nextly/src/schemas/dynamic-singles/postgres.ts)), but no migration ever created the column. The runtime `DynamicCollectionRegistryService.getCollection()` at [`src/domains/dynamic-collections/services/dynamic-collection-registry-service.ts`](packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-registry-service.ts) line 297 calls `.select()` without an explicit column list — Drizzle expands that to all declared columns including `status`. PostgreSQL returns `column "status" does not exist`, the adapter wraps it as a generic internal error, and the registration loop reports `errors: N` for every code-first collection/single the user defined.

This is distinct from the existing `migration_status` varchar column on both tables (which tracks schema-apply state, not draft/published lifecycle).

**Fix.** Adds `20260521_120000_000_dynamic_collections_singles_status.sql` for PostgreSQL and MySQL that does `ALTER TABLE … ADD COLUMN status` matching the Drizzle default (`NOT NULL DEFAULT false`). Existing rows (typically empty on fresh boot) inherit the `false` default.

**SQLite — not fixed here, but noted.** SQLite has no bundled migrations for `dynamic_collections` at all (or `dynamic_singles` — verify). The Drizzle schemas declare both tables but no `dist/migrations/sqlite/*` file creates them. Anyone using SQLite as their primary database cannot use code-first collections today. That gap needs its own PR with a `0008_dynamic_collections.sql` (and singles equivalent) bundled for SQLite — out of scope here because the bug surface is much larger than the missing column.

**Test gap that masked this.** The existing [`dynamic-collections-status-column.test.ts`](packages/nextly/src/database/__tests__/dynamic-collections-status-column.test.ts) verifies the Drizzle descriptor has the `status` column, which always passes. There is no integration test that runs the bundled migration chain against a fresh PG container and asserts `SELECT status FROM dynamic_collections` is queryable. Adding one would have caught this. Suggested follow-up alongside the equivalent test for the migration-journal create gap.

**Discovered by.** [`mobeen-site/findings/05-nextly-internal-table-naming-drift.md`](https://github.com/revnix/mobeen-site/blob/dev/findings/05-nextly-internal-table-naming-drift.md) (same investigation that surfaced the missing-create-migration-journal bug).
