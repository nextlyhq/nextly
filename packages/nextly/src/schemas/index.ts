/**
 * Public schemas barrel for Nextly.
 *
 * Single canonical entry point for the framework's system table definitions.
 * Imported by every pipeline caller (boot-apply, db-sync, migrate, migrate:create)
 * and by user code that wants to query core tables directly.
 *
 * Public contract:
 *   - getCoreSchema(dialect) → NextlySchemaSnapshot
 *   - CORE_TABLE_NAMES: readonly string[]
 *   - CORE_TABLE_PREFIXES: readonly string[]
 *   - Named Drizzle table re-exports (users, accounts, roles, etc.) under their
 *     canonical names.
 *
 * @module schemas
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { NextlySchemaSnapshot } from "../domains/schema/pipeline/diff/types";

// =============================================================================
// Public API — populated incrementally by Plan A tasks 4–14.
// =============================================================================

/**
 * Canonical core schema snapshot for the given dialect.
 *
 * Consumed by every pipeline entry point (boot-apply, db:sync, migrate Phase 1,
 * migrate:check) to drive introspect-and-diff.
 *
 * @param _dialect - the runtime dialect to compile the snapshot for
 * @returns a frozen snapshot of all framework-managed tables for that dialect
 */
export function getCoreSchema(
  _dialect: SupportedDialect
): NextlySchemaSnapshot {
  // STUB — fully implemented in Task 14 once all feature subdirs land.
  return { tables: [] };
}

/** Snake-case names of every core table the framework manages. */
export const CORE_TABLE_NAMES: readonly string[] = [
  // Populated in Task 14.
];

/** Prefixes that identify managed user tables (dc_, single_, comp_). */
export const CORE_TABLE_PREFIXES: readonly string[] = [
  "dc_",
  "single_",
  "comp_",
];

// =============================================================================
// Transitional re-exports — kept so existing consumers keep building during
// the feature-by-feature migration. Each existing export is dropped from this
// list as its replacement lands in schemas/<feature>/.
// =============================================================================

export * from "./user"; // Zod — moved to _zod/ in Task 4
export * from "./rbac"; // Zod — moved to _zod/ in Task 4
export * from "./validation"; // Zod — moved to _zod/ in Task 4
export * from "./dynamic-collections"; // dialect-aware barrel — kept; unchanged
export * from "./dynamic-components"; // kept; unchanged
export * from "./migrations"; // dropped in Plan B; kept here in Plan A
export * from "./api-keys"; // consolidated in Task 11
export * from "./security-config"; // Zod — review in Task 19
