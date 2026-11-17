/**
 * A database read whole, for the tests that assert a refused command changed nothing: every
 * table's columns as the schema pipeline reads them, and every row.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";

/** The tables the schema lock keeps its row in; the process holding it writes them. */
export const LOCK_TABLES = new Set([
  "nextly_schema_lock",
  "nextly_field_group_lock",
  "nextly_migrate_lock",
]);

const quote = (dialect: SupportedDialect, name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** Every table but the lock's, with its columns as the pipeline reads them and all its rows. */
export async function databaseState(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<{ shape: unknown; rows: Record<string, string[]> }> {
  const tables = (await adapter.listTables())
    .filter(name => !LOCK_TABLES.has(name))
    .sort();
  const shape = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    dialect,
    tables
  );
  const rows: Record<string, string[]> = {};
  for (const table of tables) {
    const read = await adapter.executeQuery<Record<string, unknown>>(
      `SELECT * FROM ${quote(dialect, table)}`
    );
    rows[table] = read.map(row => JSON.stringify(row)).sort();
  }
  return { shape, rows };
}
