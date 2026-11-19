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
import type { ForeignKeySpec } from "../pipeline/diff/types";
import {
  sqliteTableRebuildStatements,
  untrackedConstraintRefusal,
} from "../pipeline/sql-templates/sqlite-rebuild";

/** A column's change of type, as the rebuild makes it. */
export interface SqliteTypeChange {
  /** The type it becomes. */
  type: string;
  /**
   * The reference Nextly made for the field before, a relationship's, where it had one: the key
   * the rebuild drops, matched by its whole identity, so any other reference stays.
   */
  formerKey?: Pick<
    ForeignKeySpec,
    | "columns"
    | "referencesTable"
    | "referencesColumns"
    | "onDelete"
    | "onUpdate"
  >;
  /**
   * The field before was unique (a one-to-one, or marked unique): its column's inline UNIQUE, in a
   * table an older release made, is Nextly's to leave out.
   */
  formerUnique: boolean;
  /** The field after is unique. */
  unique: boolean;
}

/** Two lists of names alike, case aside, in order. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length &&
    a.every((name, i) => name.toLowerCase() === b[i]?.toLowerCase())
  );
}

/**
 * The references a rebuild drops: the one Nextly made for a former relationship's column, now that
 * it holds another type, known by its whole identity (its column, the table and column it
 * references, and its actions). Any other reference stays, and the rebuild keeps it as it keeps
 * every constraint the table has.
 */
function formerRelationshipKeys(
  keys: readonly ForeignKeySpec[],
  retyped: ReadonlyMap<string, SqliteTypeChange>
): ForeignKeySpec[] {
  return keys.filter(key => {
    const [column] = key.columns;
    const former =
      column === undefined
        ? undefined
        : retyped.get(column.toLowerCase())?.formerKey;
    return (
      former !== undefined &&
      sameNames(key.columns, former.columns) &&
      key.referencesTable.toLowerCase() ===
        former.referencesTable.toLowerCase() &&
      sameNames(key.referencesColumns, former.referencesColumns) &&
      key.onDelete === former.onDelete &&
      key.onUpdate === former.onUpdate
    );
  });
}

/**
 * The inline UNIQUE constraints a rebuild keeps: each the live table declares, but a unique former
 * field's (an older one-to-one's) where the field after is not unique.
 */
function keptUniqueOf(
  unique: readonly (readonly string[])[],
  retyped: ReadonlyMap<string, SqliteTypeChange>
): (readonly string[])[] {
  return unique.filter(columns => {
    const [column] = columns;
    if (columns.length !== 1 || column === undefined) return true;
    const change = retyped.get(column.toLowerCase());
    return !(change?.formerUnique === true && !change.unique);
  });
}

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
    types?: ReadonlyMap<string, SqliteTypeChange>;
    /**
     * The change's own judgement of the values a type change converts, run on this transaction
     * before anything of the rebuild: a value written after the change was planned is judged too,
     * and no write comes between it and the copy. It refuses by throwing, so nothing commits.
     */
    judge?: (db: unknown) => Promise<void>;
  }
): Promise<void> {
  const {
    required,
    types = new Map<string, SqliteTypeChange>(),
    judge,
  } = columns;
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
  const changeOf = (column: string) => types.get(column.toLowerCase());
  const typeOf = (column: string) => changeOf(column)?.type;
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

  // The columns this rebuild gives another type, with what the fields before and after were.
  const retyped = new Map(
    live.columns.flatMap(column => {
      const change = changeOf(column.name);
      return change !== undefined &&
        column.type.toLowerCase() !== change.type.toLowerCase()
        ? [[column.name.toLowerCase(), change] as const]
        : [];
    })
  );
  const dropped = formerRelationshipKeys(live.foreignKeys ?? [], retyped);
  const rebuilt = {
    ...live,
    ...(live.foreignKeys === undefined
      ? {}
      : {
          foreignKeys: live.foreignKeys.filter(key => !dropped.includes(key)),
        }),
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
  // The live table's inline UNIQUE constraints, those it keeps, and those it leaves out on purpose.
  const inlineUnique = losses?.unique ?? [];
  const keptUnique = keptUniqueOf(inlineUnique, retyped);
  // The dropped references named as dropped, so the rebuild's guard takes them as gone on purpose
  // rather than as constraints it would lose.
  const drops = dropped.map(foreignKey => ({
    type: "drop_foreign_key" as const,
    tableName: live.name,
    foreignKey,
  }));
  for (const statement of sqliteTableRebuildStatements(rebuilt, drops, {
    keptUnique,
    leftOutUnique: inlineUnique.filter(
      columns => !keptUnique.includes(columns)
    ),
  })) {
    await tx.execute(statement);
  }
}
