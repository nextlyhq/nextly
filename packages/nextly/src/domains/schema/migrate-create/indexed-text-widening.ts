/**
 * A MySQL migration that widens a keyed column into TEXT or BLOB, written with the index lifted
 * around the change.
 *
 * MySQL keys a TEXT or BLOB column only by a prefix length, so `MODIFY COLUMN … TEXT` over a column
 * a whole-column index still covers fails with ERROR 1170, and the migration stops there on every
 * site that runs it. A column an earlier migration made `varchar(255)` and indexed whole is such a
 * column once the field's rule reads it as unbounded. So each such index is dropped before the
 * run's operations and created again after them, where the column is TEXT and the index keys it by
 * a prefix, as the Schema Builder keys a TEXT column (`createIndexSql`). The file's DOWN is the
 * same lift inverted: the prefix index dropped, the column narrowed back, the whole-column index
 * restored.
 *
 * Two cases are refused before any file is written, naming each column and the way out: a unique
 * index, which by a prefix would hold only a value's first characters unique, so it would not be
 * the constraint the field declares; and a table whose snapshot recorded no indexes, which cannot
 * rule one out.
 *
 * @module domains/schema/migrate-create/indexed-text-widening
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type {
  AddIndexOp,
  DropIndexOp,
  IndexSpec,
  NextlySchemaSnapshot,
  Operation,
} from "../pipeline/diff/types";
import { isMysqlTextOrBlobType } from "../pipeline/sql-templates/create-index";

/**
 * `operations`, with every recorded index that keys a column the run widens into TEXT or BLOB
 * dropped first and created again last, on MySQL. Other dialects change such a column in place, so
 * their operations are returned unchanged. Refused, before any file is written, where the lift
 * cannot keep what the index enforces: a unique index, or a table whose indexes the snapshot did
 * not record.
 *
 * Applied to the UP operations; the file's DOWN inverts them, which lifts the same index around
 * the reverse change.
 */
export function withIndexesLiftedForTextWidenings(args: {
  operations: readonly Operation[];
  /** The tables as the newest snapshot recorded them, with their indexes. */
  previous: NextlySchemaSnapshot | undefined;
  dialect: SupportedDialect;
}): Operation[] {
  if (args.dialect !== "mysql" || args.previous === undefined) {
    return [...args.operations];
  }
  const errors: { path: string; code: string; message: string }[] = [];
  const lifts = new Map<string, IndexLift>();
  const renames = renamesOf(args.operations);
  for (const widening of wideningsOf(args.operations)) {
    const blocking = indexesBlocking(widening, args.operations, args.previous);
    const refusal = refusalOf(widening, blocking);
    if (refusal !== undefined) {
      errors.push(refusal);
      continue;
    }
    // `unknown` is refused above; named here too so the indexes read are the recorded ones.
    const lifting =
      blocking === "none" || blocking === "unknown" ? [] : blocking;
    for (const index of lifting) {
      // An index over two widened columns is lifted once.
      lifts.set(
        `${widening.recordedTable}.${index.name}`,
        liftOf(widening, index, renames)
      );
    }
  }
  if (errors.length > 0) {
    // Each refusal in the message itself, as the run's other refusals are, so the command prints
    // the columns and the way out rather than a bare "validation failed".
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: errors.map(e => e.message).join(" "),
      publicData: { errors },
      logContext: {
        reason: "indexed column widened to text",
        columns: errors.map(e => e.path),
      },
    });
  }
  if (lifts.size === 0) return [...args.operations];
  return [
    ...[...lifts.values()].map(lift => lift.drop),
    ...args.operations,
    ...[...lifts.values()].map(lift => lift.restore),
  ];
}

/** One index lifted around a widening: dropped under its recorded names, made again under the run's. */
interface IndexLift {
  drop: DropIndexOp;
  restore: AddIndexOp;
}

/**
 * The refusal a widening gets where the lift cannot keep what an index enforces, or undefined: a
 * unique index, and a table whose snapshot recorded no indexes.
 */
function refusalOf(
  widening: Widening,
  blocking: IndexSpec[] | "none" | "unknown"
): { path: string; code: string; message: string } | undefined {
  if (blocking === "none") return undefined;
  const unique = blocking === "unknown" ? [] : blocking.filter(i => i.unique);
  if (blocking !== "unknown" && unique.length === 0) return undefined;
  const subject =
    `${widening.table}.${widening.column} would change from ${widening.fromType} to ` +
    `${widening.toType}, which MySQL cannot do while `;
  return {
    path: `${widening.table}.${widening.column}`,
    code: "INDEXED_COLUMN_WIDENING",
    message:
      subject +
      (blocking === "unknown"
        ? "an index may key the whole column: the newest snapshot predates recording indexes, so " +
          "whether one does cannot be read. Give the field a maxLength, which keeps the column " +
          "bounded and its index, or remove the field's index, then run migrate:create again."
        : `the unique index ${unique.map(i => i.name).join(", ")} keys the whole column, and ` +
          "MySQL could key TEXT only by its first characters, which would no longer hold whole " +
          "values unique. Give the field a maxLength, which keeps the column bounded and unique, or " +
          "turn its Unique setting off, then run migrate:create again."),
  };
}

/**
 * `index` lifted around `widening`: dropped under the names the snapshot recorded, before any of
 * the run's renames, and created again under the names the run leaves, after its change.
 */
function liftOf(
  widening: Widening,
  index: IndexSpec,
  renames: Renames
): IndexLift {
  const columnAfter = (recorded: string): string => {
    for (const [after, before] of renames.columnBefore) {
      if (before === recorded && after.startsWith(`${widening.table}.`)) {
        return after.slice(widening.table.length + 1);
      }
    }
    return recorded;
  };
  return {
    drop: { type: "drop_index", tableName: widening.recordedTable, index },
    restore: {
      type: "add_index",
      tableName: widening.table,
      index: { ...index, columns: index.columns.map(columnAfter) },
    },
  };
}

/** A column this run widens into TEXT or BLOB, by its names before and after the run. */
interface Widening {
  /** The table and column as the run leaves them. */
  table: string;
  column: string;
  /** The table and column as the newest snapshot recorded them. */
  recordedTable: string;
  recordedColumn: string;
  fromType: string;
  toType: string;
}

/**
 * Every column the operations widen from a type MySQL keys whole into TEXT or BLOB: a type change,
 * and a rename that changes the type with it. A renamed column or table is traced back to the
 * name the snapshot recorded, which its indexes still use: the rename decisions are applied
 * before this is asked, so a type change names the column as it will be.
 */
function wideningsOf(operations: readonly Operation[]): Widening[] {
  const renames = renamesOf(operations);
  return operations.flatMap(op => {
    const widening = wideningOf(op, renames);
    return widening === undefined ? [] : [widening];
  });
}

/** The names a run's renames gave tables and columns, mapped back to the names they had. */
interface Renames {
  tableBefore: ReadonlyMap<string, string>;
  /** Keyed `table.column`, by the names the run leaves. */
  columnBefore: ReadonlyMap<string, string>;
}

function renamesOf(operations: readonly Operation[]): Renames {
  const tableBefore = new Map<string, string>();
  const columnBefore = new Map<string, string>();
  for (const op of operations) {
    if (op.type === "rename_table") tableBefore.set(op.toName, op.fromName);
    if (op.type === "rename_column") {
      columnBefore.set(`${op.tableName}.${op.toColumn}`, op.fromColumn);
    }
  }
  return { tableBefore, columnBefore };
}

/** A column's type change, by its names as the run leaves them: a retype, or a rename's. */
interface TypeChange {
  table: string;
  column: string;
  /** The column's recorded name, where the operation itself is the rename. */
  recorded: string | undefined;
  fromType: string;
  toType: string;
}

function typeChangeOf(op: Operation): TypeChange | undefined {
  switch (op.type) {
    case "change_column_type":
      return {
        table: op.tableName,
        column: op.columnName,
        recorded: undefined,
        fromType: op.fromType,
        toType: op.toType,
      };
    case "rename_column":
      return {
        table: op.tableName,
        column: op.toColumn,
        recorded: op.fromColumn,
        fromType: op.fromType,
        toType: op.toType,
      };
    default:
      return undefined;
  }
}

/** `op` as a widening from a type MySQL keys whole into TEXT or BLOB, or undefined. */
function wideningOf(op: Operation, renames: Renames): Widening | undefined {
  const change = typeChangeOf(op);
  if (
    change === undefined ||
    !isMysqlTextOrBlobType(change.toType) ||
    isMysqlTextOrBlobType(change.fromType)
  ) {
    return undefined;
  }
  return {
    table: change.table,
    column: change.column,
    recordedTable: renames.tableBefore.get(change.table) ?? change.table,
    recordedColumn:
      change.recorded ??
      renames.columnBefore.get(`${change.table}.${change.column}`) ??
      change.column,
    fromType: change.fromType,
    toType: change.toType,
  };
}

/**
 * The recorded indexes that key `widening`'s column and that the run keeps; `none`; or `unknown`
 * where the snapshot recorded no indexes for the table, which a snapshot written before indexes
 * were recorded does not, and an index there cannot be ruled out. An index the same run drops (a
 * unique flag turned off with the widening) stands no longer when the column changes.
 */
function indexesBlocking(
  widening: Widening,
  operations: readonly Operation[],
  previous: NextlySchemaSnapshot
): IndexSpec[] | "none" | "unknown" {
  const table = previous.tables.find(t => t.name === widening.recordedTable);
  if (table === undefined) return "none";
  if (table.indexes === undefined) return "unknown";
  const dropped = new Set(
    operations.flatMap(op =>
      op.type === "drop_index" &&
      (op.tableName === widening.table ||
        op.tableName === widening.recordedTable)
        ? [op.index.name]
        : []
    )
  );
  const blocking = table.indexes.filter(
    index =>
      index.columns.includes(widening.recordedColumn) &&
      !dropped.has(index.name)
  );
  return blocking.length === 0 ? "none" : blocking;
}
