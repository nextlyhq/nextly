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
import { parseColumnType } from "../../value-conversion/column-type";
import {
  judgeStoredColumn,
  keyedByOf,
  type KeyedBy,
} from "../../value-conversion/read-values";
import type { ConversionJudgement } from "../../value-conversion/types";
import { countLongerThan } from "../classifier/count-helpers";
import { narrowingRefusal } from "../classifier/narrowing-refusal";
import { stringNarrowingLimit } from "../classifier/type-widening";
import { introspectLiveColumns } from "../diff/introspect-live";
import {
  isPreResolutionOp,
  isReferenceConversion,
  isReferenceListConversion,
  type ChangeColumnTypeOp,
  type Operation,
} from "../diff/types";
// F11 PR 3: SQL-template generation moved to the shared sql-templates/
// module (pipeline/sql-templates/) so both the apply pipeline (renames +
// drops) and migrate:create (all op types) consume the same per-dialect
// templates. Eliminates the byte-identical-SQL drift risk.
import { referenceConversionStatements } from "../reference-list-conversion";
import { conversionForRename } from "../rename-conversion";
import { assertSchemaLockHeld, markedForSchemaLock } from "../schema-lock";
import { generateSQL } from "../sql-templates/index";

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
  dialect: SupportedDialect,
  /**
   * Statements that must precede every rename and drop here — the apply's
   * check and foreign-key drops, which would otherwise block dropping or
   * retyping a column they name. Run after the refusals below, so a refused
   * apply has changed nothing even on MySQL, where DDL commits as it runs.
   */
  leadingStatements: readonly string[] = []
): Promise<number> {
  const preOps = ops.filter(
    op => isPreResolutionOp(op) || isMysqlStringNarrowing(op, dialect)
  );
  if (preOps.length === 0 && leadingStatements.length === 0) return 0;

  const ordered = orderForExecution(preOps);

  // Asked before anything executes, while every column still has the name it was found under.
  //
  // A conversion refused by the engine is recoverable on PostgreSQL, where the whole apply is in a
  // transaction. On MySQL it is not: DDL commits implicitly, so a rename that has already run stays
  // run, and the column is left renamed and unconverted with nothing able to take it back. The only
  // safe moment to discover that the data will not convert is before the first statement.
  await assertConversionsAreSafe(txOrDb, ordered, dialect);
  await assertNarrowingsFit(txOrDb, ordered, dialect);

  for (const statement of leadingStatements) {
    await runRaw(txOrDb, statement, dialect);
  }

  for (const op of ordered) {
    await runOrderedOp(txOrDb, op, dialect);
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
      await runConversion(txOrDb, conversion, dialect);
    }
  }

  return ordered.length;
}

/** One ordered op's statements; a MySQL string narrowing runs strict (`runInStrictMysqlSession`). */
async function runOrderedOp(
  txOrDb: unknown,
  op: Operation,
  dialect: SupportedDialect
): Promise<void> {
  if (isMysqlStringNarrowing(op, dialect)) {
    await runInStrictMysqlSession(
      txOrDb,
      generateSQL(withLiveNullability(op), dialect)
    );
    return;
  }
  for (const statement of statementsForOp(op, dialect)) {
    await runRaw(txOrDb, statement, dialect);
  }
}

/** A rename's type change; a MySQL string narrowing runs strict, as its own narrowings do. */
async function runConversion(
  txOrDb: unknown,
  conversion: Operation,
  dialect: SupportedDialect
): Promise<void> {
  const statement = generateSQL(conversion, dialect);
  if (isMysqlStringNarrowing(conversion, dialect)) {
    await runInStrictMysqlSession(txOrDb, statement);
  } else {
    await runRaw(txOrDb, statement, dialect);
  }
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
  // The name each table answers to RIGHT NOW. Column ops carry the table's post-rename name,
  // because they normally run after `rename_table` — but this runs before anything at all, so the
  // new name does not exist yet and probing it would fail on a table that is merely about to be
  // called that.
  const currentTableName = new Map<string, string>();
  for (const op of ordered) {
    if (op.type === "rename_table")
      currentTableName.set(op.toName, op.fromName);
  }

  for (const op of ordered) {
    if (op.type !== "rename_column") continue;
    const conversions = conversionForRename(op, dialect);
    // Only a conversion INTO json is a question this probe can answer. Any change of type at all
    // produces `change_column_type`, so gating on its mere presence would run a JSON check against a
    // column becoming `varchar(255)` or `bigint` and refuse an ordinary rename as unconvertible.
    const converts = conversions.find(
      (c): c is ChangeColumnTypeOp =>
        c.type === "change_column_type" &&
        parseColumnType({ type: c.toType, nullable: true }).family === "json"
    );
    if (converts === undefined) continue;

    // The probe is asked about the type change with the nullability left as it is, so it weighs no
    // NULL, which cannot make a cast fail. A NULL can make a NOT NULL fail, so a conversion carrying
    // a nullability change would be guarded by a question that leaves it out — and would still look
    // guarded.
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
            `The probe judges the type change alone, so it cannot speak for "${unguarded.type}". ` +
            `Pass that change to the value-conversion judgement and add it to COVERED_CONVERSIONS ` +
            `before this op runs on this path.`,
        },
      });
    }

    // Both names as the database currently has them: nothing has run yet, so neither the table's
    // new name nor the column's exists.
    const liveTable = currentTableName.get(op.tableName) ?? op.tableName;
    // The shared judgement every path that changes a saved column uses; any value it would clear
    // or change refuses the rename here, before anything has run.
    const judgement = await judgeStoredColumn(
      txOrDb,
      {
        dialect,
        from: { type: converts.fromType, nullable: true },
        to: { type: converts.toType, nullable: true },
        compareAs: "json",
      },
      {
        table: liveTable,
        column: op.fromColumn,
        keyedBy: await liveKeyOf(txOrDb, dialect, liveTable),
      }
    );
    if (judgement.class === "safe") continue;

    throw NextlyError.validation({
      errors: [
        {
          path: `${liveTable}.${op.fromColumn}`,
          code: "COLUMN_NOT_CONVERTIBLE",
          message: hasNoConversion(judgement)
            ? `Column "${op.fromColumn}" on "${liveTable}" is ${converts.fromType}, which Nextly ` +
              `has no conversion to ${converts.toType} for, so renaming it to "${op.toColumn}" ` +
              `as a JSON column is refused. Nothing has been changed.`
            : `Column "${op.fromColumn}" on "${liveTable}" holds values that are not valid JSON, ` +
              `so renaming it to "${op.toColumn}" as a JSON column would lose them. Nothing has ` +
              `been changed. Remove the field and add it again if the existing values are not ` +
              `needed, or correct the stored values first.`,
        },
      ],
    });
  }

  await assertReferenceListsConvert(txOrDb, ordered, currentTableName, dialect);
}

/** Whether a judgement refused the pair of types itself, whatever the rows hold. */
function hasNoConversion(judgement: ConversionJudgement): boolean {
  return judgement.reasons.some(reason => reason.kind === "no-conversion");
}

/**
 * How a live table's rows are keyed, from its primary key as the database reports it: a rename
 * can reach any table the diff manages, a translation table keyed by its parent and locale
 * included, so no one key is assumed.
 */
async function liveKeyOf(
  txOrDb: unknown,
  dialect: SupportedDialect,
  table: string
): Promise<KeyedBy> {
  const snapshot = await introspectLiveColumns(txOrDb, dialect, [table]);
  return keyedByOf(snapshot.tables[0]?.columns ?? []);
}

/**
 * Refuse an apply in which a column becoming a relation's list of references holds a value that
 * cannot be read as one. Asked before the first statement runs, so a refused conversion leaves the
 * whole apply unchanged, on MySQL too.
 */
async function assertReferenceListsConvert(
  txOrDb: unknown,
  ordered: Operation[],
  currentTableName: ReadonlyMap<string, string>,
  dialect: SupportedDialect
): Promise<void> {
  for (const op of ordered) {
    if (!isReferenceListConversion(op)) continue;
    const liveTable = currentTableName.get(op.tableName) ?? op.tableName;
    const judgement = await judgeStoredColumn(
      txOrDb,
      {
        dialect,
        from: { type: op.fromType, nullable: true },
        to: { type: op.toType, nullable: true },
        compareAs: "json",
        referenceList: true,
      },
      {
        table: liveTable,
        column: op.columnName,
        keyedBy: await liveKeyOf(txOrDb, dialect, liveTable),
      }
    );
    if (judgement.class === "safe") continue;

    throw NextlyError.validation({
      errors: [
        {
          path: `${liveTable}.${op.columnName}`,
          code: "COLUMN_NOT_CONVERTIBLE",
          message: hasNoConversion(judgement)
            ? `Column "${op.columnName}" on "${liveTable}" is ${op.fromType}, which Nextly has no ` +
              `conversion to a list of references for. Nothing has been changed.`
            : `Column "${op.columnName}" on "${liveTable}" holds a value that is neither a single ` +
              `id, an array of ids nor a JSON list, so it cannot become a list of references. ` +
              `Nothing has been changed. Find the row whose value starts with "{" or "[" but does ` +
              `not parse, and correct or clear it first.`,
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
  const referenceListConversions: Operation[] = [];
  const keyDrops: Operation[] = [];
  for (const op of ops) {
    if (op.type === "drop_foreign_key") keyDrops.push(op);
    else if (op.type === "rename_table") renameTables.push(op);
    else if (op.type === "rename_column") renameColumns.push(op);
    else if (op.type === "drop_index") dropIndexes.push(op);
    else if (op.type === "drop_column") dropColumns.push(op);
    else if (op.type === "drop_table") dropTables.push(op);
    else if (isReferenceConversion(op)) referenceListConversions.push(op);
  }
  // Conversions last: they name a column by the name it has once every rename has run, on a table
  // no drop removes, and they must run before the route's own DDL, which this whole pass precedes.
  return [
    // A key on a column converted below, first: dropping a constraint changes no name or row.
    ...keyDrops,
    ...renameTables,
    ...renameColumns,
    ...dropIndexes,
    ...dropColumns,
    ...dropTables,
    ...referenceListConversions,
    // Last, like the conversions and for the same reason: a MySQL string narrowing
    // (`isMysqlStringNarrowing`) names its column as every rename has left it.
    ...ops.filter(
      op => op.type === "change_column_type" && !isReferenceConversion(op)
    ),
  ];
}

/**
 * Whether `op` narrows a MySQL string column to `varchar(N)`, so that running it can cut a stored
 * value short.
 *
 * The classifier lets such a change through without a prompt once it has counted no value longer
 * than N, but a value written after that count is one it never saw, and drizzle-kit would run the
 * change on whichever pooled connection it takes, in whatever mode the server gives it. So it runs
 * here instead, on the apply's own connection in strict mode (`runInStrictMysqlSession`), and a
 * value that no longer fits makes the statement fail rather than lose its end. The kit then finds
 * the column already converted, and plans nothing for it.
 */
function isMysqlStringNarrowing(
  op: Operation,
  dialect: SupportedDialect
): boolean {
  return (
    dialect === "mysql" &&
    op.type === "change_column_type" &&
    op.conversion === undefined &&
    stringNarrowingLimit(op.fromType, op.toType, dialect) !== null
  );
}

/**
 * Refuses the apply, before any statement runs, when a MySQL string narrowing it is about to make
 * would cut a stored value short: its own narrowings, and the type change a confirmed rename
 * carries. The classifier counts the first kind already, but a rename reached it as a drop and an
 * add, with no type change to count; asked here, every narrowing is counted where the values still
 * sit, under the table and column names they have before any rename runs. MySQL commits each
 * statement as it runs, so a refusal found after the first one would leave it behind.
 */
async function assertNarrowingsFit(
  txOrDb: unknown,
  ordered: readonly Operation[],
  dialect: SupportedDialect
): Promise<void> {
  if (dialect !== "mysql") return;
  for (const check of narrowingsToCount(ordered, dialect)) {
    const longer = await countLongerThan(
      txOrDb,
      dialect,
      check.tableName,
      check.columnName,
      check.limit
    );
    if (longer > 0) throw narrowingRefusal({ ...check, longer });
  }
}

interface NarrowingCheck {
  tableName: string;
  columnName: string;
  fromType: string;
  toType: string;
  limit: number;
}

/**
 * Every MySQL string narrowing `ordered` makes, named as the table and column are before any rename
 * runs: an op's own, and the type change of each rename.
 */
function narrowingsToCount(
  ordered: readonly Operation[],
  dialect: SupportedDialect
): NarrowingCheck[] {
  const tableBeforeRename = new Map<string, string>();
  for (const op of ordered) {
    if (op.type === "rename_table")
      tableBeforeRename.set(op.toName, op.fromName);
  }
  const liveTable = (name: string) => tableBeforeRename.get(name) ?? name;

  const checks: NarrowingCheck[] = [];
  for (const op of ordered) {
    if (op.type === "change_column_type") {
      checks.push(
        ...narrowingCheck(op, liveTable(op.tableName), op.columnName, dialect)
      );
    } else if (op.type === "rename_column") {
      for (const conversion of conversionForRename(op, dialect)) {
        if (conversion.type !== "change_column_type") continue;
        checks.push(
          ...narrowingCheck(
            conversion,
            liveTable(op.tableName),
            op.fromColumn,
            dialect
          )
        );
      }
    }
  }
  return checks;
}

/** The check for one type change, when it is a MySQL string narrowing; none otherwise. */
function narrowingCheck(
  op: ChangeColumnTypeOp,
  tableName: string,
  columnName: string,
  dialect: SupportedDialect
): NarrowingCheck[] {
  if (!isMysqlStringNarrowing(op, dialect)) return [];
  const limit = stringNarrowingLimit(op.fromType, op.toType, dialect);
  if (limit === null) return [];
  return [
    { tableName, columnName, fromType: op.fromType, toType: op.toType, limit },
  ];
}

/**
 * A narrowing restated with the nullability the column has now. MySQL's MODIFY restates the whole
 * definition, so the diff's operation carries the target nullability; run here, ahead of the
 * pre-cleanup that fills or removes the NULLs a NOT NULL would refuse, it would fail on exactly the
 * rows the operator chose to resolve. The column keeps what it has, and the NOT NULL is left to
 * the route that runs after the cleanup.
 */
function withLiveNullability(op: Operation): Operation {
  if (op.type !== "change_column_type" || op.fromNullable === undefined) {
    return op;
  }
  return { ...op, nullable: op.fromNullable };
}

/**
 * Run one MySQL statement in strict mode on this connection, with the session's own mode put back
 * afterwards whether the statement succeeded or not, so the pooled connection the apply returns
 * carries nothing of it. `STRICT_ALL_TABLES` is added to the session's mode, keeping its other
 * flags.
 */
async function runInStrictMysqlSession(
  txOrDb: unknown,
  statement: string
): Promise<void> {
  await runRaw(txOrDb, "SET @nextly_sql_mode = @@SESSION.sql_mode", "mysql");
  await runRaw(
    txOrDb,
    "SET SESSION sql_mode = TRIM(BOTH ',' FROM CONCAT(@@SESSION.sql_mode, ',STRICT_ALL_TABLES'))",
    "mysql"
  );
  try {
    await runRaw(txOrDb, statement, "mysql");
  } finally {
    await runRaw(txOrDb, "SET SESSION sql_mode = @nextly_sql_mode", "mysql");
  }
}

// F11 PR 3: this function used to dispatch to four `buildXxxSql` helpers
// from the now-deleted `pre-resolution/sql-templates.ts`. The new shared
// `sql-templates/` module exposes a single `generateSQL(op, dialect)`
// entry point that handles all 9 Operation variants. The `isPreResolutionOp`
// filter still gates which ops reach this executor — additive ops (add_*,
// change_*) are handled by pushSchema's later pass, not here.
//
// A reference-list conversion is asked for its statement LIST: on MySQL it is three statements, and
// the driver runs one per call, so the joined form a migration file carries would be refused.
function statementsForOp(op: Operation, dialect: SupportedDialect): string[] {
  if (isReferenceConversion(op)) {
    return referenceConversionStatements(op, dialect);
  }
  return [generateSQL(op, dialect)];
}

/**
 * Run one raw SQL statement in the call pattern its dialect needs: SQLite's
 * Drizzle database (better-sqlite3) exposes only a synchronous `.run()`, while
 * PostgreSQL's and MySQL's expose an async `.execute()`. Calling `.execute()` on
 * SQLite throws, so DDL written that way never runs there.
 */
export async function runRaw(
  txOrDb: unknown,
  sqlString: string,
  dialect: SupportedDialect
): Promise<void> {
  // A run that lost the schema lock starts no further statement (`assertSchemaLockHeld`).
  await assertSchemaLockHeld();
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
  // Carries the run's claim, so a run taking the lock over can find and stop it.
  await handle.execute(sql.raw(markedForSchemaLock(sqlString)));
}
