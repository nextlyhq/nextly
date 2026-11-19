/**
 * Repair for registry timestamps SQLite stored in milliseconds.
 *
 * The registries of collections, Singles and field groups keep `created_at` and `updated_at` as
 * unix seconds (`integer({ mode: "timestamp" })`). The registry-row statement a migration file
 * carries once wrote "now" in milliseconds, so a row it wrote reads as created tens of thousands
 * of years ahead. Nothing fails on the way in or out: the date is simply wrong, and whatever
 * compares it is wrong with it. The labelling of archived translations is one such reader
 * (`labelLegacyArchiveRows`): no row is archived after a date that far ahead, so it finds no
 * owner and marks the row unresolved for good.
 *
 * The statement now writes seconds. Files generated before it did keep the earlier statement, and
 * write milliseconds again each time one is applied to a database, so this is not a one-time
 * repair: it runs at the end of every `nextly migrate` on SQLite, and once at a start.
 *
 * Raw SQL, as the other SQLite repair is (`repair-sqlite-timestamps`): the value has to be
 * compared and divided as the integer the database holds, which the column's decoder would turn
 * into a date first, and the field-group registry's name is one the database decides.
 *
 * @module database/repair-sqlite-registry-timestamps
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { resolveRegistryTableName } from "../domains/field-groups/storage/resolve-storage-names";
import { reopenUnresolvedArchiveRows } from "../domains/i18n/migration/label-legacy-archive-rows";

/**
 * Above this a stored value is milliseconds. As seconds it is the year 5138; as milliseconds it
 * is March 1973, before any registry row was written. A repaired value is far below it, which is
 * what makes a second run change nothing.
 */
const MILLISECONDS_ABOVE = 100_000_000_000;

/** The two timestamps every registry keeps. */
const TIMESTAMP_COLUMNS = ["created_at", "updated_at"] as const;

export interface RegistryTimestampRepair {
  /** Registry rows with at least one timestamp rewritten. */
  repaired: number;
  /** The addresses whose creation date was rewritten: what a reader of it judged wrongly. */
  createdCorrected: string[];
}

/** Quote an identifier for SQLite, doubling any embedded quotes. */
function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** The registries this database has, by the names it holds them under. */
async function registryTables(adapter: DrizzleAdapter): Promise<string[]> {
  const names = [
    "dynamic_collections",
    "dynamic_singles",
    await resolveRegistryTableName(adapter),
  ];
  const present: string[] = [];
  for (const name of names) {
    if (await adapter.tableExists(name)) present.push(name);
  }
  return present;
}

/**
 * Rewrites one registry's millisecond timestamps as seconds, and answers the rows it touched and
 * the addresses whose creation date it corrected.
 */
async function repairRegistry(
  adapter: DrizzleAdapter,
  table: string
): Promise<RegistryTimestampRepair> {
  const inMilliseconds = (column: string) =>
    `${quote(column)} > ${MILLISECONDS_ABOVE}`;
  const affected = await adapter.executeQuery<{
    slug: string;
    created: number;
  }>(
    `SELECT slug, ${inMilliseconds("created_at")} AS created FROM ${quote(table)}
      WHERE ${TIMESTAMP_COLUMNS.map(inMilliseconds).join(" OR ")}`
  );
  if (affected.length === 0) return { repaired: 0, createdCorrected: [] };
  for (const column of TIMESTAMP_COLUMNS) {
    // Whole seconds: the earlier statement wrote seconds times a thousand.
    await adapter.executeQuery(
      `UPDATE ${quote(table)} SET ${quote(column)} = ${quote(column)} / 1000
        WHERE ${inMilliseconds(column)}`
    );
  }
  return {
    repaired: affected.length,
    createdCorrected: affected
      .filter(row => Number(row.created) > 0)
      .map(row => row.slug),
  };
}

/**
 * Rewrite the registries' millisecond timestamps as seconds, and hand the archived translations
 * of each address whose creation date was corrected back to the labelling: marked unresolved
 * while their owner read as created far ahead, they are unknown again, for the next labelling to
 * judge by the corrected date (`reopenUnresolvedArchiveRows`). No other address's rows are
 * touched.
 *
 * Idempotent: a repaired value is below the line the repair looks above, and an address is
 * handed back only in the run that corrects it.
 */
export async function repairSqliteRegistryTimestamps(
  adapter: DrizzleAdapter
): Promise<RegistryTimestampRepair> {
  const result: RegistryTimestampRepair = { repaired: 0, createdCorrected: [] };
  for (const table of await registryTables(adapter)) {
    const { repaired, createdCorrected } = await repairRegistry(adapter, table);
    result.repaired += repaired;
    result.createdCorrected.push(...createdCorrected);
  }
  if (result.createdCorrected.length > 0) {
    await reopenUnresolvedArchiveRows(adapter, result.createdCorrected);
  }
  return result;
}
