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
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors";

import { querySqlRows } from "./classifier/count-helpers";
import type { NextlySchemaSnapshot, Operation } from "./diff/types";
import { liveTableName, renamesOf } from "./live-uniques";
import { liveNames, rowsHold, subjectOf } from "./several-references-refusal";
import type { DesiredSchema } from "./types";

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
  const lower = (name: string) => name.toLowerCase();
  const renames = renamesOf(args.operations);
  const created = new Set(
    args.operations.flatMap(op =>
      op.type === "add_table" ? [lower(op.table.name)] : []
    )
  );
  const liveColumns = new Map(
    args.live.tables.map(table => [
      lower(table.name),
      new Set(table.columns.map(column => lower(column.name))),
    ])
  );
  const errors: { path: string; code: string; message: string }[] = [];
  for (const op of args.operations) {
    if (op.type !== "add_foreign_key") continue;
    const { columns, referencesTable, referencesColumns } = op.foreignKey;
    // One column holding one id, already on the table: a new table or column has no rows to check.
    if (columns.length !== 1 || referencesColumns.length !== 1) continue;
    // Read where they stand before this apply: a table or column it renames under its old name.
    const source = liveNames(renames, op.tableName, columns[0]);
    if (
      liveColumns.get(lower(source.table))?.has(lower(source.column)) !== true
    ) {
      continue;
    }
    const target = liveTableName(referencesTable, renames);
    // A target this apply creates holds no rows yet, so every value the column holds breaks it.
    // Any other target is read as it stands, a core table such as `users` among them.
    const targetIsLive = !created.has(lower(referencesTable));
    const [row] = await querySqlRows<{ n: number | string }>(
      args.db,
      args.dialect,
      targetIsLive
        ? sql`SELECT COUNT(*) AS n FROM ${sql.identifier(source.table)} AS r
              WHERE r.${sql.identifier(source.column)} IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM ${sql.identifier(target)} AS t
                  WHERE t.${sql.identifier(referencesColumns[0])} = r.${sql.identifier(source.column)}
                )`
        : sql`SELECT COUNT(*) AS n FROM ${sql.identifier(source.table)} AS r
              WHERE r.${sql.identifier(source.column)} IS NOT NULL`
    );
    const column = columns[0];
    const rows = Number(row?.n ?? 0);
    if (rows === 0) continue;
    const { label, field } = subjectOf(args.desired, op.tableName, column);
    errors.push({
      path: `fields.${field}`,
      code: "RELATIONSHIP_VALUES_MISSING_FROM_TARGET",
      message: `${label}: field '${field}' can't point at '${referencesTable}' while ${rowsHold(rows)} a value with no matching entry there. Change or clear the field on ${rows === 1 ? "that row" : "those rows"} first, or keep its target as it is.`,
    });
  }
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: { reason: "relationship-values-missing-from-target" },
  });
}
