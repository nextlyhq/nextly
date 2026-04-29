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
// F11 PR 3: SQL-template generation moved to the shared sql-templates/
// module (pipeline/sql-templates/) so both the apply pipeline (renames +
// drops) and migrate:create (all op types) consume the same per-dialect
// templates. Eliminates the byte-identical-SQL drift risk.
import { generateSQL } from "../sql-templates/index.js";

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

// F11 PR 3: this function used to dispatch to four `buildXxxSql` helpers
// from the now-deleted `pre-resolution/sql-templates.ts`. The new shared
// `sql-templates/` module exposes a single `generateSQL(op, dialect)`
// entry point that handles all 9 Operation variants. The `isPreResolutionOp`
// filter still gates which ops reach this executor — additive ops (add_*,
// change_*) are handled by pushSchema's later pass, not here.
function sqlForOp(op: Operation, dialect: SupportedDialect): string {
  return generateSQL(op, dialect);
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
