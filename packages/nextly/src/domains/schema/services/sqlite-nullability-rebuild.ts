/**
 * Makes columns of a SQLite table NOT NULL or nullable, or changes their types, which SQLite can
 * only do by rebuilding the table: a new table of the live definition with the columns changed, every row copied, the old
 * one dropped and the new one renamed into place, its indexes recreated.
 *
 * Run inside `executeTransaction`, which turns foreign keys off before BEGIN: a translations
 * table's `_parent` references its main table `ON DELETE CASCADE`, so dropping the main table with
 * them on would delete every translation. The table is read inside the same transaction, so a
 * statement that ran before it in the unit (a column added) is part of what is rebuilt.
 *
 * @module domains/schema/services/sqlite-nullability-rebuild
 */
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import type { MigrationTransaction } from "../migrate/migration-transaction";
import {
  introspectLiveSnapshot,
  introspectSqliteRebuildLosses,
} from "../pipeline/diff/introspect-live";
import {
  sqliteTableRebuildStatements,
  untrackedConstraintRefusal,
} from "../pipeline/sql-templates/sqlite-rebuild";

/**
 * Rebuilds `tableName` with each column of `required` NOT NULL (true) or nullable (false), and
 * each column of `types` of the type it names. Nothing runs when every column already is.
 *
 * A type change copies each value across as it is, which SQLite stores by the new column's type
 * affinity (a text `"12"` becomes the number 12 in a numeric column): the values are judged before
 * the change is planned, and one the new type cannot take refuses the save before this runs.
 *
 * The rebuild keeps every row, the primary key, types, defaults, foreign keys in and out, checks
 * and indexes, and each UNIQUE the live table declares inline (a one-to-one's column), which no
 * spec describes.
 *
 * @throws NextlyError `VALIDATION_ERROR` for a table with a trigger, which a rebuild would drop
 *   and nothing could recreate. The unit is rolled back, so nothing has changed.
 */
export async function rebuildSqliteNullability(
  tx: MigrationTransaction,
  tableName: string,
  columns: {
    required: ReadonlyMap<string, boolean>;
    types?: ReadonlyMap<string, string>;
  }
): Promise<void> {
  const { required, types = new Map<string, string>() } = columns;
  const snapshot = await introspectLiveSnapshot(tx.db, "sqlite", [tableName]);
  const live = snapshot.tables.find(
    table => table.name.toLowerCase() === tableName.toLowerCase()
  );
  if (live === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "sqlite-nullability-table-missing", tableName },
    });
  }
  const target = (column: string) => required.get(column.toLowerCase());
  const typeOf = (column: string) => types.get(column.toLowerCase());
  const changes = live.columns.filter(column => {
    const wanted = target(column.name);
    const type = typeOf(column.name);
    return (
      (wanted !== undefined && column.nullable === wanted) ||
      (type !== undefined && column.type.toLowerCase() !== type.toLowerCase())
    );
  });
  if (changes.length === 0) return;

  const losses = (await introspectSqliteRebuildLosses(tx.db, [tableName])).get(
    tableName.toLowerCase()
  );
  if ((losses?.triggers ?? 0) > 0) {
    throw NextlyError.validation({
      errors: [
        {
          path: `schema.${tableName}`,
          code: "SQLITE_REBUILD_WOULD_DROP_UNTRACKED_CONSTRAINTS",
          message: untrackedConstraintRefusal(tableName, "triggers"),
        },
      ],
      logContext: { table: tableName, lost: "triggers" },
    });
  }

  const rebuilt = {
    ...live,
    columns: live.columns.map(column => {
      const wanted = target(column.name);
      const type = typeOf(column.name);
      // A new type is spelled as declared, so the old declaration's modifier (`numeric(10,2)`'s
      // `10,2`) is not carried onto it.
      const { typeModifier, ...rest } = column;
      return {
        ...(type === undefined && typeModifier !== undefined
          ? { ...rest, typeModifier }
          : rest),
        ...(wanted === undefined ? {} : { nullable: !wanted }),
        ...(type === undefined ? {} : { type }),
      };
    }),
  };
  for (const statement of sqliteTableRebuildStatements(rebuilt, [], {
    keptUnique: losses?.unique ?? [],
  })) {
    await tx.execute(statement);
  }
  // Only the columns this rebuild retypes: one already of its type holds what it held before.
  const retyped = new Map(
    live.columns.flatMap(column => {
      const type = typeOf(column.name);
      return type !== undefined &&
        column.type.toLowerCase() !== type.toLowerCase()
        ? [[column.name, type] as const]
        : [];
    })
  );
  await refuseValuesTheTypesCannotTake(tx.db, tableName, retyped);
}

/**
 * Whether SQLite stores a column of this declared type by numeric affinity (its own rules: an
 * `INT` is INTEGER; `CHAR`, `CLOB` or `TEXT` is TEXT; `BLOB` or no type is BLOB; anything else,
 * `REAL`, `DOUBLE` and `NUMERIC` among them, is numeric).
 */
function numericAffinity(type: string): boolean {
  const declared = type.toUpperCase();
  if (declared.includes("INT")) return true;
  if (/CHAR|CLOB|TEXT|BLOB/.test(declared) || declared.trim() === "") {
    return false;
  }
  return true;
}

/**
 * Refuses, inside the rebuild's transaction so nothing of it commits, a column whose type changed
 * to a numeric one but holds a value SQLite could not convert: SQLite keeps such a value as it was
 * (`"abc"` stays text in an integer column) rather than refusing it. The values are judged before a
 * save plans the change; this holds where one was written in between.
 */
async function refuseValuesTheTypesCannotTake(
  db: unknown,
  tableName: string,
  types: ReadonlyMap<string, string>
): Promise<void> {
  const reader = db as { all(query: unknown): unknown };
  for (const [column, type] of types) {
    if (!numericAffinity(type)) continue;
    const rows: unknown = await Promise.resolve(
      reader.all(
        sql`SELECT COUNT(*) AS "unconverted" FROM ${sql.identifier(tableName)}
            WHERE ${sql.identifier(column)} IS NOT NULL
              AND typeof(${sql.identifier(column)}) NOT IN ('integer', 'real')`
      )
    );
    const [row] = Array.isArray(rows)
      ? (rows as { unconverted: number }[])
      : [];
    const unconverted = Number(row?.unconverted ?? 0);
    if (unconverted === 0) continue;
    throw NextlyError.validation({
      errors: [
        {
          path: `schema.${tableName}.${column}`,
          code: "TYPE_CHANGE_LOSES_VALUES",
          message: `${column} holds ${String(unconverted)} ${unconverted === 1 ? "value" : "values"} that can't be stored as ${type}, so its type was not changed.`,
        },
      ],
      logContext: { table: tableName, column, type, unconverted },
    });
  }
}
