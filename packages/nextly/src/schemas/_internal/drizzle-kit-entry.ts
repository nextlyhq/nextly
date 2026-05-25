/**
 * Drizzle-kit entry point for `drizzle-kit generate`.
 *
 * `drizzle.config.ts` points at this file because drizzle-kit expects a
 * single TS entry whose top-level exports are the Drizzle table objects
 * to introspect. The multi-dialect `getCoreSchema(dialect)` factory in
 * `schemas/index.ts` isn't callable from drizzle-kit's static loader, so
 * this module:
 *
 * 1. Reads `DB_DIALECT` at module-load time and picks the matching
 *    dialect bundle from `./_dialect-bundles`.
 * 2. Merges in the host app's `src/db/schemas/dynamic/index.ts` exports
 *    (collected by `@nextly/scripts/merge-schemas`) so user-defined
 *    tables show up alongside core tables in `drizzle-kit generate`.
 * 3. Re-exports the merged set as top-level CommonJS bindings via
 *    `(exports as Record<string, unknown>)[key] = value` so drizzle-kit's
 *    TS loader sees them as if each were a hand-written `export const`.
 *
 * This file replaces `services/lib/unified-schema.ts`, which Plan A Task
 * 18 deleted. Living under `schemas/_internal/` keeps it next to the
 * dialect bundles it consumes and signals the underscore-prefixed
 * "framework-internal" status — host apps should not import this
 * directly.
 *
 * @module schemas/_internal/drizzle-kit-entry
 * @since v0.0.3-alpha (Plan A Task 18 — replaces services/lib/unified-schema.ts)
 */

import * as mergedSchemas from "@nextly/scripts/merge-schemas";

import * as mysqlSchemas from "../_dialect-bundles/mysql";
import * as postgresSchemas from "../_dialect-bundles/postgres";
import * as sqliteSchemas from "../_dialect-bundles/sqlite";

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
