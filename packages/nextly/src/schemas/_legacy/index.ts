/**
 * Legacy tables (transitional) — dialect-namespaced barrel.
 *
 * The `systemMigrations` and `contentSchemaEvents` tables are scheduled for
 * removal in Plan B (`nextly upgrade`). Their Drizzle definitions live here
 * during Plan A so the few remaining importers (database/schema/<dialect>.ts
 * re-exports) keep compiling, then the entire `_legacy/` directory is
 * deleted in Plan B.
 *
 * Consumers should not add new imports of this module.
 *
 * @deprecated Plan A transitional. Removed by Plan B's first task.
 * @module schemas/_legacy
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

export * as pg from "./postgres";
export * as my from "./mysql";
export * as sl from "./sqlite";
