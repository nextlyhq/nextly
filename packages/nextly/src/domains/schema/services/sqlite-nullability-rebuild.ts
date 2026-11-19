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
 * affinity (a text `"12"` becomes the number 12 in a numeric column). SQLite keeps a value it
 * cannot convert rather than refusing it, so the values are judged first, by `judge`, on this
 * transaction.
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
    /**
     * The change's own judgement of the values a type change converts, run on this transaction
     * before anything of the rebuild: a value written after the change was planned is judged too,
     * and no write comes between it and the copy. It refuses by throwing, so nothing commits.
     */
    judge?: (db: unknown) => Promise<void>;
  }
): Promise<void> {
  const { required, types = new Map<string, string>(), judge } = columns;
  if (types.size > 0) await judge?.(tx.db);
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
}
