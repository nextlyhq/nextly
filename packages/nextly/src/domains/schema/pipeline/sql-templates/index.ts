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

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import type { Operation } from "../diff/types.js";

import { generateMysqlSQL } from "./mysql.js";
import { generatePgSQL } from "./postgres.js";
import { generateSqliteSQL } from "./sqlite.js";

export { quoteIdent } from "./identifier-quoting.js";
export { MysqlUnsupportedOperationError } from "./mysql.js";
export { SqliteUnsupportedOperationError } from "./sqlite.js";

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
