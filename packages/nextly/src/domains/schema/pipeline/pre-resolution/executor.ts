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
//   3. drop_index    - after renames (MySQL's DROP INDEX ... ON <table>
//                      references the current table name) and before column
//                      drops: SQLite cannot DROP COLUMN while an index still
//                      covers the column.
//   4. drop_column   - column drops on tables that survive the apply.
//   5. drop_table    - last so we don't lose tables we still need to
//                      reference for column-level ops.
//
// Each op is executed via the dialect's standard call pattern:
//   - PG/MySQL via drizzle-orm: tx.execute(sql.raw(...))
//   - SQLite via drizzle-orm/better-sqlite3: db.run(sql.raw(...))
//
// Caller is responsible for transaction wrapping. F3's pipeline already
// runs us inside db.transaction() for PG/MySQL; SQLite uses pragma + raw
// statements per F3 PR-4 (see pushschema-pipeline.ts).

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../../errors";
import { isPreResolutionOp, type Operation } from "../diff/types";
// F11 PR 3: SQL-template generation moved to the shared sql-templates/
// module (pipeline/sql-templates/) so both the apply pipeline (renames +
// drops) and migrate:create (all op types) consume the same per-dialect
// templates. Eliminates the byte-identical-SQL drift risk.
import { conversionForRename } from "../rename-conversion";
import { generateSQL } from "../sql-templates/index";

import { columnHoldsOnlyJson } from "./json-convertibility";

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

  // Asked before anything executes, while every column still has the name it was found under.
  //
  // A conversion refused by the engine is recoverable on PostgreSQL, where the whole apply is in a
  // transaction. On MySQL it is not: DDL commits implicitly, so a rename that has already run stays
  // run, and the column is left renamed and unconverted with nothing able to take it back. The only
  // safe moment to discover that the data will not convert is before the first statement.
  await assertConversionsAreSafe(txOrDb, ordered, dialect);

  for (const op of ordered) {
    const sqlString = sqlForOp(op, dialect);
    await runRaw(txOrDb, sqlString, dialect);
  }

  // A rename moves the column; it does not change what the column IS. When the two sides differ, the
  // rename alone leaves the old type in place under the new name, so the schema the runtime reads
  // through and the column it actually reads disagree from that moment on.
  //
  // 🔴 Issued as a pass AFTER every ordered op rather than beside each rename, and the ordering is
  // the point. MySQL refuses to convert an indexed text column to JSON, and the index that covers it
  // is dropped in a LATER bucket than the rename — so a conversion emitted next to its own rename
  // runs while the index is still there and fails. Nothing in the buckets that follow can invalidate
  // a conversion: the column's own table survives the rename by definition, and the drops target
  // other objects.
  //
  // What to convert is decided by `conversionForRename`, which `migrate:create` also asks, so a
  // repair applied here and one written to a migration file cannot disagree about it.
  for (const op of ordered) {
    if (op.type !== "rename_column") continue;
    for (const conversion of conversionForRename(op, dialect)) {
      await runRaw(txOrDb, generateSQL(conversion, dialect), dialect);
    }
  }

  return ordered.length;
}

/**
 * The conversion statements the convertibility probe's question actually covers.
 *
 * - `change_column_type` is the statement being guarded: the probe asks whether every stored value
 *   survives it.
 * - `change_column_default` touches no stored row. A default applies to writes that have not
 *   happened, so no existing value can make it fail and the probe has nothing to say about it.
 *
 * Absent, deliberately: `change_column_nullable`, which fails on precisely the NULL rows the probe
 * filters out.
 */
export const COVERED_CONVERSIONS = [
  "change_column_type",
  "change_column_default",
] as const;

const PROBE_COVERS: ReadonlySet<string> = new Set(COVERED_CONVERSIONS);

/**
 * Refuse the whole apply when a repair would convert a column whose contents cannot survive it.
 *
 * The rename is offered on the strength of the column's NAME — a leading underscore only the old
 * builder writes. That establishes the column is legacy and says nothing about what is in it, and
 * the underscore affected every field type: a field once declared as ordinary text carries the same
 * shape, holding prose rather than serialized JSON.
 *
 * Refusing here costs the operator a failed command and their data intact. Discovering it one
 * statement later costs them a half-changed schema on MySQL.
 */
async function assertConversionsAreSafe(
  txOrDb: unknown,
  ordered: Operation[],
  dialect: SupportedDialect
): Promise<void> {
  for (const op of ordered) {
    if (op.type !== "rename_column") continue;
    const conversions = conversionForRename(op, dialect);
    const converts = conversions.some(c => c.type === "change_column_type");
    if (!converts) continue;

    // The probe reads rows that are NOT NULL, because a NULL cannot make a cast fail. It can make a
    // NOT NULL fail, so a conversion carrying a nullability change would be guarded by a question
    // asked over the wrong rows — and would still look guarded.
    //
    // Stated as what the probe DOES cover, so that an op kind added to `conversionForRename` later
    // is refused until someone decides it is covered. A list of what to reject would instead be a
    // list of the cases already thought of, and would say nothing about the one that does not exist
    // yet: exactly how a check ends up silently permitting what it was built to catch.
    const unguarded = conversions.find(c => !PROBE_COVERS.has(c.type));
    if (unguarded) {
      throw NextlyError.internal({
        logContext: {
          reason:
            "a rename conversion carries a statement the convertibility probe does not cover",
          operation: unguarded.type,
          table: op.tableName,
          column: op.fromColumn,
          // Named so the obvious response is to widen the probe. A refusal that only says no gets
          // resolved under deadline by deleting the check.
          remedy:
            `The probe reads only rows that are NOT NULL, so it cannot speak for "${unguarded.type}". ` +
            `Widen columnHoldsOnlyJson to cover it and add it to COVERED_CONVERSIONS before this ` +
            `op runs on this path.`,
        },
      });
    }

    // The column still answers to its OLD name: nothing has run yet.
    const safe = await columnHoldsOnlyJson(
      txOrDb,
      op.tableName,
      op.fromColumn,
      dialect
    );
    if (safe) continue;

    throw NextlyError.validation({
      errors: [
        {
          path: `${op.tableName}.${op.fromColumn}`,
          code: "COLUMN_NOT_CONVERTIBLE",
          message:
            `Column "${op.fromColumn}" on "${op.tableName}" holds values that are not valid JSON, ` +
            `so renaming it to "${op.toColumn}" as a JSON column would lose them. Nothing has been ` +
            `changed. Remove the field and add it again if the existing values are not needed, or ` +
            `correct the stored values first.`,
        },
      ],
    });
  }
}

// Returns ops sorted into the execution-safe order described above.
// Within each op-type bucket, original input order is preserved.
function orderForExecution(ops: Operation[]): Operation[] {
  const renameTables: Operation[] = [];
  const renameColumns: Operation[] = [];
  const dropIndexes: Operation[] = [];
  const dropColumns: Operation[] = [];
  const dropTables: Operation[] = [];
  for (const op of ops) {
    if (op.type === "rename_table") renameTables.push(op);
    else if (op.type === "rename_column") renameColumns.push(op);
    else if (op.type === "drop_index") dropIndexes.push(op);
    else if (op.type === "drop_column") dropColumns.push(op);
    else if (op.type === "drop_table") dropTables.push(op);
  }
  return [
    ...renameTables,
    ...renameColumns,
    ...dropIndexes,
    ...dropColumns,
    ...dropTables,
  ];
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
