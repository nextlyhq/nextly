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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { loadDialectTables } from "../../../database/dialect-tables";
import { getDialectTables } from "../../../database/index";
import { asRepositoryDb } from "../events/repository-db";
import { runStatement } from "../pipeline/_internal/run-statement";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import {
  migrateStepColumnDescriptors,
  renderSystemColumnSql,
} from "../services/field-column-descriptor";

/** What the step needs: the Drizzle handle it reads and alters through. */
export interface DocumentColumnsArgs {
  db: unknown;
  dialect: SupportedDialect;
  logger?: { info?: (message: string) => void };
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

/** Which columns each existing table has, lower-cased. */
async function liveColumns(
  db: unknown,
  dialect: SupportedDialect,
  tables: string[]
): Promise<Map<string, Set<string>>> {
  const snapshot = await introspectLiveColumns(db, dialect, tables);
  return new Map(
    snapshot.tables.map(table => [
      table.name.toLowerCase(),
      new Set(table.columns.map(column => column.name.toLowerCase())),
    ])
  );
}

function quoteIdentifier(dialect: SupportedDialect) {
  return (name: string) =>
    dialect === "mysql"
      ? `\`${name.replace(/`/g, "``")}\``
      : `"${name.replace(/"/g, '""')}"`;
}

/**
 * Add each per-document column a content table lacks. Reports how many
 * columns it added, 0 when every table already has them all.
 */
export async function addDocumentColumns(
  args: DocumentColumnsArgs
): Promise<{ added: number }> {
  const { db, dialect } = args;
  const tables = await contentTables(db, dialect);
  if (tables.length === 0) return { added: 0 };
  const live = await liveColumns(db, dialect, tables);
  // The same descriptors `CREATE TABLE` is written from, so an added column
  // and a created one cannot differ in type, default or nullability.
  const descriptors = migrateStepColumnDescriptors(dialect);
  const q = quoteIdentifier(dialect);

  let added = 0;
  for (const table of tables) {
    const present = live.get(table.toLowerCase());
    // A registered entity whose table, or translation table, is not there.
    if (present === undefined) continue;
    for (const descriptor of descriptors) {
      if (present.has(descriptor.name)) continue;
      try {
        await runStatement(
          db,
          dialect,
          sql.raw(
            `ALTER TABLE ${q(table)} ADD COLUMN ${renderSystemColumnSql(descriptor, q)}`
          )
        );
      } catch (error) {
        // Another process added it between the catalog read and this
        // statement: done, not failed. Anything else is a real failure.
        const now = await liveColumns(db, dialect, [table]);
        if (now.get(table.toLowerCase())?.has(descriptor.name)) continue;
        throw error;
      }
      added += 1;
    }
  }
  if (added > 0) {
    args.logger?.info?.(
      `Added ${added} per-document column(s) to existing content tables.`
    );
  }
  return { added };
}
