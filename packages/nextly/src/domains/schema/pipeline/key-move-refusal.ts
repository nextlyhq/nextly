/**
 * A foreign key added to a column that already holds values, refused before anything runs while a
 * row holds a value its new target does not have.
 *
 * A keyed relationship pointed at another collection moves its key there, and a relationship an
 * earlier apply left without its key gets it now: either way the database is asked to accept a
 * key over rows that already exist. Each value is checked first, against the table the key will
 * reference, so the answer is known before any statement runs and the key is only ever added
 * where every row already satisfies it. Named the way every schema refusal names its subject: the
 * entity, the field and how many rows.
 *
 * @module domains/schema/pipeline/key-move-refusal
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors";

import { querySqlRows } from "./classifier/count-helpers";
import type {
  ForeignKeySpec,
  NextlySchemaSnapshot,
  Operation,
} from "./diff/types";
import { renamesOf } from "./live-uniques";
import { liveNames, rowsHold, subjectOf } from "./several-references-refusal";
import type { DesiredSchema } from "./types";

/** What the apply's operations change about the tables a key check reads. */
interface ApplyShape {
  renames: ReturnType<typeof renamesOf>;
  /** Tables, and `table.column`s on standing tables, the apply creates: they hold no value yet. */
  created: ReadonlySet<string>;
  /** `table.column`s the apply retypes: their values compare only after the conversion. */
  retyped: ReadonlySet<string>;
  /** The live tables' columns, by lower-cased table name. */
  liveColumns: ReadonlyMap<string, ReadonlySet<string>>;
}

const lower = (name: string) => name.toLowerCase();

function applyShapeOf(
  operations: readonly Operation[],
  live: NextlySchemaSnapshot
): ApplyShape {
  const created = new Set<string>();
  const retyped = new Set<string>();
  for (const op of operations) {
    if (op.type === "add_table") created.add(lower(op.table.name));
    if (op.type === "add_column") {
      created.add(`${lower(op.tableName)}.${lower(op.column.name)}`);
    }
    if (op.type === "change_column_type") {
      retyped.add(`${lower(op.tableName)}.${lower(op.columnName)}`);
    }
  }
  return {
    renames: renamesOf(operations),
    created,
    retyped,
    liveColumns: new Map(
      live.tables.map(table => [
        lower(table.name),
        new Set(table.columns.map(column => lower(column.name))),
      ])
    ),
  };
}

/**
 * The query counting the rows that would break `fk` on `tableName`, or null where none is asked:
 * a key of several columns, a source column the apply creates (it holds no value), or one whose
 * end the apply retypes (the values compare only after the conversion, so the database judges the
 * key as it adds it). A target the apply creates (a table, or a column on one that stands) holds
 * no value yet, so every value the source holds counts; any other target is read as it stands, a
 * core table such as `users` among them. Each name is read where it stands before the apply.
 */
function breakingRowsQuery(
  tableName: string,
  fk: ForeignKeySpec,
  shape: ApplyShape
): SQL | null {
  const { columns, referencesTable, referencesColumns } = fk;
  if (columns.length !== 1 || referencesColumns.length !== 1) return null;
  const source = liveNames(shape.renames, tableName, columns[0]);
  const sourceStands =
    shape.liveColumns.get(lower(source.table))?.has(lower(source.column)) ===
    true;
  if (!sourceStands) return null;
  const sourceKey = `${lower(tableName)}.${lower(columns[0])}`;
  const targetKey = `${lower(referencesTable)}.${lower(referencesColumns[0])}`;
  if (shape.retyped.has(sourceKey) || shape.retyped.has(targetKey)) return null;
  const holds = sql`r.${sql.identifier(source.column)} IS NOT NULL`;
  const from = sql`FROM ${sql.identifier(source.table)} AS r`;
  if (
    shape.created.has(lower(referencesTable)) ||
    shape.created.has(targetKey)
  ) {
    return sql`SELECT COUNT(*) AS n ${from} WHERE ${holds}`;
  }
  const target = liveNames(
    shape.renames,
    referencesTable,
    referencesColumns[0]
  );
  return sql`SELECT COUNT(*) AS n ${from} WHERE ${holds}
    AND NOT EXISTS (
      SELECT 1 FROM ${sql.identifier(target.table)} AS t
      WHERE t.${sql.identifier(target.column)} = r.${sql.identifier(source.column)}
    )`;
}

/**
 * Refuses the apply, naming each field and its rows, when a key `operations` add over an existing
 * column would be broken by a value no row of its target holds.
 *
 * @throws NextlyError (validation, `RELATIONSHIP_VALUES_MISSING_FROM_TARGET`)
 */
export async function refuseKeysRowsWouldBreak(args: {
  db: unknown;
  dialect: SupportedDialect;
  desired: DesiredSchema;
  /** The database as it stands, which says which columns already hold values. */
  live: NextlySchemaSnapshot;
  operations: readonly Operation[];
}): Promise<void> {
  const shape = applyShapeOf(args.operations, args.live);
  const errors: { path: string; code: string; message: string }[] = [];
  for (const op of args.operations) {
    if (op.type !== "add_foreign_key") continue;
    const query = breakingRowsQuery(op.tableName, op.foreignKey, shape);
    if (query === null) continue;
    const [row] = await querySqlRows<{ n: number | string }>(
      args.db,
      args.dialect,
      query
    );
    const rows = Number(row?.n ?? 0);
    if (rows === 0) continue;
    const { label, field } = subjectOf(
      args.desired,
      op.tableName,
      op.foreignKey.columns[0]
    );
    errors.push({
      path: `fields.${field}`,
      code: "RELATIONSHIP_VALUES_MISSING_FROM_TARGET",
      message: `${label}: field '${field}' can't point at '${op.foreignKey.referencesTable}' while ${rowsHold(rows)} a value with no matching entry there. Change or clear the field on ${rows === 1 ? "that row" : "those rows"} first, or keep its target as it is.`,
    });
  }
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: { reason: "relationship-values-missing-from-target" },
  });
}
