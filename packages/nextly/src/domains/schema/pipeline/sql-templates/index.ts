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

export { quoteIdent } from "./identifier-quoting";
export { MysqlUnsupportedOperationError } from "./mysql";
export { SqliteUnsupportedOperationError } from "./sqlite";

/**
 * SQL for one operation.
 *
 * The return value is not guaranteed to be a single statement. An operation
 * whose effect has no single-statement spelling returns several, separated by
 * `; ` — today that is PostgreSQL `drop_index` on a unique, which must drop a
 * possible owning constraint as well as the index. Callers that write the
 * result into a migration file are unaffected (the runner's splitter handles
 * it, and `index-sql.test.ts` pins that round-trip); callers that hand it to a
 * driver must be able to run a compound statement, which the pre-resolution
 * executor does on the simple-query protocol.
 *
 * Anyone adding an operation type here should know compound returns are legal,
 * and anyone adding a consumer should decide which of those two it is.
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
