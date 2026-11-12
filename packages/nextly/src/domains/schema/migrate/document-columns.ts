/**
 * The step of `nextly migrate` that gives every existing content table the
 * per-document columns: the version counter and the last changer.
 *
 * Every content table on every site needs them, whatever the app's own
 * migration files say, and no file carries them, so the core of `nextly
 * migrate` adds them. A new table gets them from the same system-column
 * declaration as every other, so this only ever finds work on a table created
 * before they existed — or created this run by a migration file written then.
 *
 * Idempotent, with the live catalog as its only record of what is done. It
 * adds whichever of the columns a table lacks, one statement per column, and
 * never writes a row: each column's default gives existing rows version 1 and
 * no changer, so no content and no `updated_at` is rewritten — which matters
 * on a MySQL table whose `updated_at` moves on any UPDATE. A run stopped
 * part-way, which on MySQL commits each statement as it runs, leaves some
 * columns added; the next run reads the catalog and adds the rest.
 *
 * @module domains/schema/migrate/document-columns
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { loadDialectTables } from "../../../database/dialect-tables";
import { getDialectTables } from "../../../database/index";
import { asRepositoryDb } from "../events/repository-db";
import { runStatement } from "../pipeline/_internal/run-statement";
import { liveColumnNames } from "../pipeline/diff/introspect-live";
import {
  migrateStepColumnDescriptors,
  renderSystemColumnSql,
} from "../services/field-column-descriptor";

/** What the step needs: the Drizzle handle it reads and alters through. */
export interface DocumentColumnsArgs {
  db: unknown;
  dialect: SupportedDialect;
  logger?: { info?: (message: string) => void };
  /**
   * Only these entities' tables, each with its translation table, are read and
   * changed: what a development start passes for the entities whose declaration
   * changed since the last one. Absent, every content table is, as `nextly
   * migrate` and the CLI run it.
   */
  tables?: readonly string[];
}

/**
 * Every table a collection entry or a Single lives in: each registered
 * entity's own table, and its translation table.
 *
 * Read from the registry rather than rebuilt from a slug, because a table can
 * be named on its own (a collection's `dbName`) and a Schema Builder entity is
 * in no config at all. A translation table that does not exist is simply not
 * found in the catalog.
 */
async function contentTables(
  db: unknown,
  dialect: SupportedDialect
): Promise<string[]> {
  // Loaded here: `nextly migrate` can reach this before anything else has
  // read this dialect's registry tables.
  await loadDialectTables(dialect);
  const tables = getDialectTables(dialect);
  const repo = asRepositoryDb(db);
  const names = new Set<string>();
  for (const registry of [tables.dynamicCollections, tables.dynamicSingles]) {
    for (const row of await repo.select().from(registry)) {
      const name = row.tableName;
      if (typeof name !== "string" || name === "") continue;
      names.add(name);
      names.add(`${name}_locales`);
    }
  }
  return [...names].sort();
}

function quoteIdentifier(dialect: SupportedDialect) {
  return (name: string) =>
    dialect === "mysql"
      ? `\`${name.replace(/`/g, "``")}\``
      : `"${name.replace(/"/g, '""')}"`;
}

type ColumnDescriptor = ReturnType<typeof migrateStepColumnDescriptors>[number];

/** Each per-document column a table that is there lacks, by table. */
function missingColumns(
  tables: readonly string[],
  live: ReadonlyMap<string, ReadonlySet<string>>,
  descriptors: readonly ColumnDescriptor[]
): { table: string; column: ColumnDescriptor }[] {
  return tables.flatMap(table => {
    // A registered entity whose table, or translation table, is not there.
    const present = live.get(table.toLowerCase());
    if (present === undefined) return [];
    return descriptors
      .filter(column => !present.has(column.name))
      .map(column => ({ table, column }));
  });
}

/**
 * Add one column. Reports false when another process added it between the
 * catalog read and this statement: done, not failed. Any other failure is
 * thrown.
 */
async function addColumn(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  column: ColumnDescriptor
): Promise<boolean> {
  const q = quoteIdentifier(dialect);
  try {
    await runStatement(
      db,
      dialect,
      sql.raw(
        `ALTER TABLE ${q(table)} ADD COLUMN ${renderSystemColumnSql(column, q)}`
      )
    );
    return true;
  } catch (error) {
    const now = await liveColumnNames(db, dialect, [table]);
    if (now.get(table.toLowerCase())?.has(column.name)) return false;
    throw error;
  }
}

/**
 * Add each per-document column a content table lacks. Reports how many
 * columns it added, 0 when every table already has them all.
 */
export async function addDocumentColumns(
  args: DocumentColumnsArgs
): Promise<{ added: number }> {
  const { db, dialect } = args;
  const only =
    args.tables &&
    new Set(args.tables.flatMap(table => [table, `${table}_locales`]));
  const tables = (await contentTables(db, dialect)).filter(
    table => only === undefined || only.has(table)
  );
  if (tables.length === 0) return { added: 0 };
  // The same descriptors `CREATE TABLE` is written from, so an added column
  // and a created one cannot differ in type, default or nullability.
  const missing = missingColumns(
    tables,
    await liveColumnNames(db, dialect, tables),
    migrateStepColumnDescriptors(dialect)
  );
  let added = 0;
  // One statement per column, each its own commit on MySQL: a run stopped
  // part-way leaves whole columns, and the next run adds the rest.
  for (const { table, column } of missing) {
    if (await addColumn(db, dialect, table, column)) added += 1;
  }
  if (added > 0) {
    args.logger?.info?.(
      `Added ${added} per-document column(s) to existing content tables.`
    );
  }
  return { added };
}

/**
 * {@link addDocumentColumns} holding the schema lock, for a caller that is not
 * already inside a run of `nextly migrate`: the development start that skips
 * it. Waits while another process holds the lock, as a first start does, so
 * the step never alters a table under a migration or a Schema Builder save.
 *
 * Not released on an interrupt: this runs inside a server, whose shutdown may
 * let the work run on, and a lock left behind lapses within one lease.
 */
export async function addDocumentColumnsUnderLock(
  adapter: DrizzleAdapter,
  logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
  },
  /** Only these entities' tables (`DocumentColumnsArgs.tables`); none is a step with nothing to do. */
  tables?: readonly string[]
): Promise<void> {
  // Nothing to read or change, so the lock is not taken either.
  if (tables !== undefined && tables.length === 0) return;
  const { withSchemaLock } = await import("../pipeline/schema-lock");
  await withSchemaLock(
    {
      adapter,
      command: "development start: per-document columns",
      whenHeld: "wait",
      releaseOnInterrupt: false,
      ...(logger ? { logger } : {}),
    },
    () =>
      addDocumentColumns({
        db: adapter.getDrizzle(),
        dialect: adapter.dialect,
        ...(logger ? { logger } : {}),
        ...(tables === undefined ? {} : { tables }),
      })
  );
}
