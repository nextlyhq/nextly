// Pre-resolution executor.
//
// Runs the SQL for ops we own (renames + drops) BEFORE drizzle-kit's
// pushSchema runs. This ensures pushSchema sees a clean schema (no
// rename ambiguity) so its TTY-prompting columnsResolver never fires.
//
// Op execution order matters and is fixed:
//   1. rename_table  - parent-level rename happens first; subsequent column
//                      ops reference the new table name.
//   2. rename_column - column-level renames within tables.
//   3. drop_column   - column drops on tables that survive the apply.
//   4. drop_table    - last so we don't lose tables we still need to
//                      reference for column-level ops.
//
// Each op is executed via the dialect's standard call pattern:
//   - PG/MySQL via drizzle-orm: tx.execute(sql.raw(...))
//   - SQLite via drizzle-orm/better-sqlite3: db.run(sql.raw(...))
//
// Caller is responsible for transaction wrapping. F3's pipeline already
// runs us inside db.transaction() for PG/MySQL; SQLite uses pragma + raw
// statements per F3 PR-4 (see pushschema-pipeline.ts).

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { isPreResolutionOp, type Operation } from "../diff/types.js";

import {
  buildDropColumnSql,
  buildDropTableSql,
  buildRenameColumnSql,
  buildRenameTableSql,
} from "./sql-templates.js";

interface AsyncExecuteHandle {
  execute(query: unknown): Promise<unknown>;
}

interface SqliteRunHandle {
  run(query: unknown): unknown;
}

/**
 * Execute pre-resolution ops in safe order.
 * Returns the number of ops executed (always equals the count of
 * pre-resolution ops in the input - non-pre-resolution ops are filtered
 * out and ignored).
 */
export async function executePreResolutionOps(
  txOrDb: unknown,
  ops: Operation[],
  dialect: SupportedDialect
): Promise<number> {
  const preOps = ops.filter(isPreResolutionOp);
  if (preOps.length === 0) return 0;

  const ordered = orderForExecution(preOps);

  for (const op of ordered) {
    const sqlString = sqlForOp(op, dialect);
    await runRaw(txOrDb, sqlString, dialect);
  }

  return ordered.length;
}

// Returns ops sorted into the execution-safe order described above.
// Within each op-type bucket, original input order is preserved.
function orderForExecution(ops: Operation[]): Operation[] {
  const renameTables: Operation[] = [];
  const renameColumns: Operation[] = [];
  const dropColumns: Operation[] = [];
  const dropTables: Operation[] = [];
  for (const op of ops) {
    if (op.type === "rename_table") renameTables.push(op);
    else if (op.type === "rename_column") renameColumns.push(op);
    else if (op.type === "drop_column") dropColumns.push(op);
    else if (op.type === "drop_table") dropTables.push(op);
  }
  return [...renameTables, ...renameColumns, ...dropColumns, ...dropTables];
}

function sqlForOp(op: Operation, dialect: SupportedDialect): string {
  switch (op.type) {
    case "rename_column":
      return buildRenameColumnSql(
        op.tableName,
        op.fromColumn,
        op.toColumn,
        dialect
      );
    case "rename_table":
      return buildRenameTableSql(op.fromName, op.toName, dialect);
    case "drop_column":
      return buildDropColumnSql(op.tableName, op.columnName, dialect);
    case "drop_table":
      return buildDropTableSql(op.tableName, dialect);
    case "add_table":
    case "add_column":
    case "change_column_type":
    case "change_column_nullable":
    case "change_column_default":
      // Filter (isPreResolutionOp) ensures we never reach here at runtime.
      // Listing the additive cases keeps the switch exhaustive for current
      // Operation variants - the default branch's `never` check below
      // catches FUTURE variants added to the union.
      throw new Error(
        `executePreResolutionOps: non-pre-resolution op leaked through filter: ${op.type}`
      );
    default: {
      // If a new Operation variant is added later, the switch becomes
      // non-exhaustive and TS narrows op to that new variant here. The
      // `never` annotation forces a compile error - so adding a variant
      // requires updating this switch (and the filter alongside it).
      const _exhaustive: never = op;
      void _exhaustive;
      throw new Error(
        `executePreResolutionOps: unhandled op variant: ${(op as { type: string }).type}`
      );
    }
  }
}

async function runRaw(
  txOrDb: unknown,
  sqlString: string,
  dialect: SupportedDialect
): Promise<void> {
  if (dialect === "sqlite") {
    // better-sqlite3 / drizzle-orm/better-sqlite3 uses synchronous .run()
    // (and tx wrappers also expose .run()). The F3 pipeline runs SQLite
    // outside drizzle's tx() per the pragma compatibility note in
    // pushschema-pipeline.ts:240.
    const handle = txOrDb as SqliteRunHandle;
    handle.run(sql.raw(sqlString));
    return;
  }
  // PG and MySQL use async .execute()
  const handle = txOrDb as AsyncExecuteHandle;
  await handle.execute(sql.raw(sqlString));
}
