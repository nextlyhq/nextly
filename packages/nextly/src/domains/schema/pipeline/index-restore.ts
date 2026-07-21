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

import type { NextlySchemaSnapshot } from "./diff/types";
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
  statements: readonly string[]
): string[] {
  const rebuilt = rebuiltTableNames(statements);
  if (rebuilt.size === 0) return [];

  return desired.tables
    .filter(table => rebuilt.has(table.name.toLowerCase()))
    .flatMap(table =>
      // `undefined` means the snapshot never tracked indexes, which is not the
      // same as the table having none. Only an explicit list is actionable.
      (table.indexes ?? []).map(index =>
        generateSQL(
          { type: "add_index", tableName: table.name, index },
          dialect
        )
      )
    );
}
