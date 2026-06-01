/**
 * Detection of legacy bookkeeping tables (`nextly_migrations`,
 * `nextly_migration_journal`) so boot + CLI can require `nextly upgrade`
 * before continuing (spec §4.10).
 *
 * Takes the minimal `{ tableExists }` slice of the database adapter so it is
 * decoupled from the concrete `DrizzleAdapter` type and trivially testable.
 *
 * @module domains/schema/events/legacy-detection
 * @since v0.0.3-alpha (Plan B)
 */

import { NextlyError } from "../../../errors";

/** The legacy tables consolidated and dropped by `nextly upgrade`. */
export const LEGACY_BOOKKEEPING_TABLES = [
  "nextly_migrations",
  "nextly_migration_journal",
] as const;

/** Minimal adapter slice the detection needs. */
export interface LegacyDetectionAdapter {
  tableExists: (tableName: string) => Promise<boolean>;
}

export interface LegacyDetectionResult {
  hasLegacy: boolean;
  tables: string[];
}

/** Returns which legacy bookkeeping tables (if any) exist in the live DB. */
export async function detectLegacyBookkeeping(
  adapter: LegacyDetectionAdapter
): Promise<LegacyDetectionResult> {
  const tables: string[] = [];
  for (const name of LEGACY_BOOKKEEPING_TABLES) {
    if (await adapter.tableExists(name)) tables.push(name);
  }
  return { hasLegacy: tables.length > 0, tables };
}

/**
 * Boot/CLI gate. Throws `NEXTLY_LEGACY_BOOKKEEPING_DETECTED` if any legacy
 * bookkeeping table is present, pointing the operator at `nextly upgrade`.
 * The `upgrade` command itself must NOT call this (it is the remedy).
 */
export async function assertNoLegacyBookkeeping(
  adapter: LegacyDetectionAdapter
): Promise<void> {
  const result = await detectLegacyBookkeeping(adapter);
  if (result.hasLegacy) {
    throw new NextlyError({
      code: "NEXTLY_LEGACY_BOOKKEEPING_DETECTED",
      publicMessage:
        `Legacy bookkeeping tables detected (${result.tables.join(", ")}). ` +
        "Run `pnpm nextly upgrade` once to consolidate them into " +
        "nextly_schema_events before continuing.",
    });
  }
}
