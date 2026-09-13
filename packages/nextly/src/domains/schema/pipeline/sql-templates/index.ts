// F11 PR 3: per-dialect SQL template dispatcher.
//
// Single entry point for converting an Operation (from the F4 diff
// engine) into a SQL string. Two consumers:
//
// 1. The apply pipeline's `pre-resolution/executor.ts` calls this for
//    renames + drops (the ops it executes BEFORE pushSchema).
// 2. The migrate-create CLI calls this for ALL operation types,
//    materializing each one as a `.sql` file statement.
//
// Pure functions throughout. No I/O. No semicolons (callers add `;`
// when joining statements for file output; the apply pipeline runs
// each statement individually so no separator is needed).
//
// SQLite throws SqliteUnsupportedOperationError for in-place type /
// nullable / default changes — the operator must use a recreate-table
// workaround. PG and MySQL support all 9 operation types.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { Operation } from "../diff/types";

import { generateMysqlSQL } from "./mysql";
import { generatePgSQL } from "./postgres";
import { generateSqliteSQL } from "./sqlite";

export {
  addForeignKeySql,
  changeForeignKeyActionStatements,
  dropForeignKeySql,
} from "./foreign-key-action";
export type { ForeignKeyActionDialect } from "./foreign-key-action";
export { quoteIdent } from "./identifier-quoting";
export { MysqlUnsupportedOperationError } from "./mysql";
export { SqliteUnsupportedOperationError } from "./sqlite";

/**
 * SQL for one operation, as a single string.
 *
 * The return value is NOT guaranteed to be a single statement. An operation
 * whose effect has no single-statement spelling returns several, separated by
 * `; ` — today PostgreSQL `drop_index` on a unique (it must drop a possible
 * owning constraint as well as the index) and `change_foreign_key_action` on
 * both dialects that can perform it.
 *
 * Which consumers can take that, measured rather than assumed:
 *
 * - A migration FILE is safe. `splitSqlStatements` (cli/commands/migrate.ts)
 *   is a literal-aware `;` splitter, so a compound entry becomes separate
 *   statements again; `index-sql.test.ts` pins that round-trip.
 * - The pre-resolution executor is safe: it runs compound statements on the
 *   simple-query protocol.
 * - A caller that hands the string to a driver DIRECTLY is NOT safe. Both
 *   `splitStatements` (pipeline/sql-statement-utils.ts) and
 *   `CollectionFileManager.runMigration` split only on `--> statement-
 *   breakpoint` and never on `;`, deliberately — a lexical `;` split corrupts
 *   string literals. A compound entry therefore reaches the driver whole,
 *   which PostgreSQL and SQLite tolerate and MySQL rejects outright, because
 *   the adapter sets `multipleStatements = false`.
 *
 * That last case is a real defect this repository shipped, not a hypothetical:
 * the Schema Builder's referential-action edit emitted a compound string and
 * did nothing at all on MySQL. So a consumer that executes statements itself
 * should ask the operation's own renderer for the LIST — see
 * {@link changeForeignKeyActionStatements} — rather than this joined form.
 */
export function generateSQL(op: Operation, dialect: SupportedDialect): string {
  switch (dialect) {
    case "postgresql":
      return generatePgSQL(op);
    case "mysql":
      return generateMysqlSQL(op);
    case "sqlite":
      return generateSqliteSQL(op);
    default: {
      const exhaustive: never = dialect;
      void exhaustive;
      throw new Error(`generateSQL: unsupported dialect ${dialect as string}`);
    }
  }
}
