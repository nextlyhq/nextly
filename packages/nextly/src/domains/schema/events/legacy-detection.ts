/**
 * Detection of legacy bookkeeping tables (`nextly_migrations`,
 * `nextly_migration_journal`), which `nextly migrate` moves into
 * `nextly_schema_events` once a backup is confirmed, and which every other
 * command that needs the history there refuses until it has.
 *
 * Takes the minimal `{ tableExists }` slice of the database adapter so it is
 * decoupled from the concrete `DrizzleAdapter` type and trivially testable.
 *
 * @module domains/schema/events/legacy-detection
 * @since v0.0.3-alpha (Plan B)
 */

import { NextlyError } from "../../../errors";

/** The legacy tables `nextly migrate` consolidates and drops. */
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
 * The gate of the commands that do not move the records themselves. Throws
 * `NEXTLY_LEGACY_BOOKKEEPING_DETECTED` if any legacy bookkeeping table is
 * present, naming the command that moves them. `nextly migrate` does not
 * call this: it is the remedy.
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
        "Back up the database, then run `nextly migrate --backup-confirmed` " +
        "once to move them into nextly_schema_events before continuing.",
    });
  }
}
