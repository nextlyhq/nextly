/**
 * Dynamic dialect-aware schema aggregator for drizzle-kit migration tooling.
 *
 * `drizzle.config.ts` points at this file because drizzle-kit expects a
 * single TS entry point whose top-level exports are the Drizzle table
 * objects to introspect. We can't hand drizzle-kit the multi-dialect
 * `getCoreSchema(dialect)` factory (it doesn't call functions), so this
 * module:
 *
 * 1. Reads `DB_DIALECT` at module-load time and picks the matching dialect
 *    bundle from `@nextly/schemas/_dialect-bundles`.
 * 2. Merges in the host app's `src/db/schemas/dynamic/index.ts` exports
 *    (collected by `@nextly/scripts/merge-schemas`) so user-defined
 *    tables show up alongside core tables in `drizzle-kit generate`.
 * 3. Re-exports the merged set as top-level CommonJS bindings via
 *    `exports[key] = value` so drizzle-kit's TS loader sees them as if
 *    each were a hand-written `export const`.
 *
 * Plan A note: this file used to consume `@nextly/database/schema/<dialect>`,
 * which Plan A Task 17 deleted. The imports now point at the dialect
 * bundles in `@nextly/schemas/_dialect-bundles`. The file itself is slated
 * for removal in Task 18 once `drizzle.config.ts` learns to talk to
 * `schemas/_dialect-bundles` directly.
 *
 * @module services/lib/unified-schema
 * @since v0.0.3-alpha (Plan A Task 17 — rewired to @nextly/schemas)
 */

import * as mergedSchemas from "@nextly/scripts/merge-schemas";

import * as mysqlSchemas from "../../schemas/_dialect-bundles/mysql";
import * as postgresSchemas from "../../schemas/_dialect-bundles/postgres";
import * as sqliteSchemas from "../../schemas/_dialect-bundles/sqlite";

const dialect = process.env.DB_DIALECT || "postgresql";
console.log("🧩 Using dialect:", dialect);

let activeSchemas: Record<string, unknown> = {};

switch (dialect) {
  case "postgres":
  case "postgresql":
    activeSchemas = postgresSchemas;
    break;
  case "mysql":
    activeSchemas = mysqlSchemas;
    break;
  case "sqlite":
  case "sqlite3":
    activeSchemas = sqliteSchemas;
    break;
  default:
    console.warn(`⚠️ Unknown dialect '${dialect}', defaulting to Postgres`);
    activeSchemas = postgresSchemas;
}

const unifiedSchemas = {
  ...activeSchemas,
  ...mergedSchemas,
};

for (const [key, value] of Object.entries(unifiedSchemas)) {
  (exports as Record<string, unknown>)[key] = value;
}
