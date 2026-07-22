/**
 * Re-creating the indexes a rebuild takes with it.
 *
 * Two things decide what a dynamic table looks like and only one of them
 * knows about indexes. The diff's desired side comes from
 * `buildDesiredTableFromFields`, which carries a full `IndexSpec[]`; the
 * Drizzle tables handed to drizzle-kit come from `generateRuntimeSchema`,
 * which declares none. drizzle-kit therefore believes every table should have
 * no secondary index, so the replacement table it builds during a SQLite
 * rebuild has none either, and the indexes go with the table it dropped.
 * Nothing reports it: the push succeeds, the rows are intact, and the queries
 * just get slower.
 *
 * A module of its own so the rule can be tested without loading the pipeline,
 * which reaches the database barrel for its Drizzle table maps and so pulls
 * adapter build output into anything that imports it.
 *
 * @module domains/schema/pipeline/index-restore
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { IndexSpec, NextlySchemaSnapshot, Operation } from "./diff/types";
import { rebuiltTableNames } from "./filter-unsafe-statements";
import { generateSQL } from "./sql-templates";

/**
 * `CREATE INDEX` for every index the desired schema declares on a table this
 * batch rebuilds.
 *
 * Scoped to rebuilt tables, NOT to every table the apply touched. A table
 * altered in place still has its indexes, and re-creating one that exists is
 * not harmless: MySQL has no `CREATE INDEX IF NOT EXISTS`, so a duplicate key
 * name aborts the apply — after MySQL has already auto-committed the DDL ahead
 * of it.
 *
 * Pure, so the statements can be asserted directly. The caller appends them to
 * the push batch, which runs them after the table changes they index.
 */
export function indexRestoreStatements(
  desired: NextlySchemaSnapshot,
  dialect: SupportedDialect,
  statements: readonly string[],
  ops: readonly Operation[] = []
): string[] {
  const rebuilt = rebuiltTableNames(statements);
  const emitted = new Set<string>();
  const out: string[] = [];

  const add = (tableName: string, index: IndexSpec): void => {
    // Same index can arrive from both sources — a rebuilt table whose diff
    // also asked for one of its indexes. Emit it once.
    const key = `${tableName.toLowerCase()}::${index.name.toLowerCase()}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    out.push(generateSQL({ type: "add_index", tableName, index }, dialect));
  };

  // A rebuilt table lost every index it had, so all of them are replayed.
  for (const table of desired.tables) {
    if (!rebuilt.has(table.name.toLowerCase())) continue;
    // `undefined` means the snapshot never tracked indexes, which is not the
    // same as the table having none. Only an explicit list is actionable.
    for (const index of table.indexes ?? []) add(table.name, index);
  }

  // An `add_index` op is the diff stating the index is absent, so creating it
  // cannot duplicate one. This is the only thing that creates it on SQLite and
  // MySQL: the fast-path emitter is PostgreSQL-only, and the schema handed to
  // drizzle-kit declares no dynamic-table indexes, so a diff of nothing but
  // index additions would otherwise apply zero statements and report success
  // while the index stayed missing.
  for (const op of ops) {
    if (op.type !== "add_index") continue;
    add(op.tableName, op.index);
  }

  return out;
}
