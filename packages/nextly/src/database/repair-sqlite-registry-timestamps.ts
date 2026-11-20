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
 * repair: it runs in every `nextly migrate` on SQLite, once its files are applied, and once at a start.
 *
 * Written with Drizzle's `sql`, not through the registries' table objects: the value has to be
 * compared and divided as the integer the database holds, which a table's column would decode
 * into a date first, and the field-group registry's name is one the database decides.
 *
 * @module database/repair-sqlite-registry-timestamps
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql, type SQL } from "drizzle-orm";

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

/** How many addresses one statement names. */
const SLUGS_PER_STATEMENT = 200;

export interface RegistryTimestampRepair {
  /** Registry rows with at least one timestamp rewritten. */
  repaired: number;
  /** The addresses whose creation date was rewritten: what a reader of it judged wrongly. */
  createdCorrected: string[];
}

/** The slice of SQLite's Drizzle handle the repair drives: a read and a write of built SQL. */
interface RepairDb {
  all<T>(query: SQL): T[] | Promise<T[]>;
  run(query: SQL): unknown;
}

/**
 * Whether a registry's column holds milliseconds in a row: an integer above the line. The type is
 * asked first because SQLite orders any text above any number: a timestamp an older writer
 * stored as text (`repair-sqlite-timestamps`) would read as above the line too, and dividing it
 * would leave the number its first digits spell, which that repair could no longer read.
 */
const inMilliseconds = (column: string): SQL =>
  sql`(typeof(${sql.identifier(column)}) = 'integer' AND ${sql.identifier(column)} > ${sql.raw(String(MILLISECONDS_ABOVE))})`;

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

/** One registry's rows holding milliseconds: each address, and whether its creation date does. */
async function millisecondRows(
  db: RepairDb,
  table: string
): Promise<Array<{ slug: string; created: boolean }>> {
  const rows = await db.all<{ slug: string; created: number }>(
    sql`SELECT slug, ${inMilliseconds("created_at")} AS created
        FROM ${sql.identifier(table)}
        WHERE ${sql.join(TIMESTAMP_COLUMNS.map(inMilliseconds), sql` OR `)}`
  );
  return rows.map(row => ({
    slug: row.slug,
    created: Number(row.created) > 0,
  }));
}

/** Rewrites the millisecond timestamps of `slugs` in one registry as whole seconds. */
async function rewriteAsSeconds(
  db: RepairDb,
  table: string,
  slugs: readonly string[]
): Promise<void> {
  for (let i = 0; i < slugs.length; i += SLUGS_PER_STATEMENT) {
    const named = sql.join(
      slugs.slice(i, i + SLUGS_PER_STATEMENT).map(slug => sql`${slug}`),
      sql`, `
    );
    for (const column of TIMESTAMP_COLUMNS) {
      // Only the rows read above, so the rows reported are the rows rewritten; a row another
      // writer adds meanwhile is the next run's. Whole seconds: the earlier statement wrote
      // seconds times a thousand.
      await db.run(
        sql`UPDATE ${sql.identifier(table)}
            SET ${sql.identifier(column)} = ${sql.identifier(column)} / 1000
            WHERE ${inMilliseconds(column)} AND slug IN (${named})`
      );
    }
  }
}

/** The registries' rows holding milliseconds: by registry, and the addresses whose creation date does. */
interface MillisecondRows {
  found: Array<{ table: string; slugs: string[] }>;
  rows: number;
  createdInMilliseconds: string[];
}

/** Reads, writing nothing, every registry row holding milliseconds (`millisecondRows`). */
async function registryRowsInMilliseconds(
  adapter: DrizzleAdapter
): Promise<MillisecondRows> {
  const db = adapter.getDrizzle<RepairDb>();
  const read: MillisecondRows = {
    found: [],
    rows: 0,
    createdInMilliseconds: [],
  };
  for (const table of await registryTables(adapter)) {
    const rows = await millisecondRows(db, table);
    if (rows.length === 0) continue;
    read.found.push({ table, slugs: rows.map(row => row.slug) });
    read.rows += rows.length;
    read.createdInMilliseconds.push(
      ...rows.filter(row => row.created).map(row => row.slug)
    );
  }
  return read;
}

/**
 * The addresses whose archived translations the repair would hand back to the labelling: those
 * whose registry row's creation date is still in milliseconds. Read only, as the repair reads
 * them.
 */
export async function addressesCreatedInMilliseconds(
  adapter: DrizzleAdapter
): Promise<string[]> {
  return (await registryRowsInMilliseconds(adapter)).createdInMilliseconds;
}

/**
 * Rewrite the registries' millisecond timestamps as seconds, and hand the archived translations
 * of each address whose creation date was wrong back to the labelling: marked unresolved while
 * their owner read as created far ahead, they are unknown again, for the next labelling to judge
 * by the corrected date (`reopenUnresolvedArchiveRows`). No other address's rows are touched.
 *
 * The archive is handed back before the dates are rewritten. A run stopped between the two
 * leaves the dates in milliseconds, so the next run finds the same addresses and does both
 * again; the other order would rewrite the dates and never hand the archive back.
 *
 * Idempotent: a repaired value is below the line the repair looks above, and an address is
 * handed back only by a run that finds its date wrong.
 */
export async function repairSqliteRegistryTimestamps(
  adapter: DrizzleAdapter
): Promise<RegistryTimestampRepair> {
  const db = adapter.getDrizzle<RepairDb>();
  const { found, rows, createdInMilliseconds } =
    await registryRowsInMilliseconds(adapter);
  const result: RegistryTimestampRepair = {
    repaired: rows,
    createdCorrected: createdInMilliseconds,
  };
  if (result.createdCorrected.length > 0) {
    await reopenUnresolvedArchiveRows(adapter, result.createdCorrected);
  }
  for (const { table, slugs } of found) {
    await rewriteAsSeconds(db, table, slugs);
  }
  return result;
}
