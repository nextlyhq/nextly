/**
 * The one way a SQLite table is swapped for a rebuilt copy of itself.
 *
 * SQLite changes most of a table's definition only by creating the table again and moving its rows
 * across. Both rebuilds do it through here: the migration file's (`sqlite-rebuild`), which declares
 * the new table from its target spec, and the column conversion's (`repair-columns/conversion/
 * sqlite`), which declares it from the live table's own stored statement with one column changed.
 *
 * The statements, run in one transaction by the caller:
 *
 * 1. Drop the triggers on other tables and on views that read the table, then the views that read
 *    it. With `legacy_alter_table` off (SQLite's default), the rename in step 5 checks every view
 *    and trigger in the schema and refuses while one still names a table that is gone ("error in
 *    view v: no such table: main.t"), measured on SQLite 3.53. A trigger on a view goes with the
 *    view, so it is dropped first by name, which keeps the drop of either order-independent.
 * 2. Where the table has an AUTOINCREMENT key, carry its sequence to the twin's name before the
 *    twin exists: SQLite keeps that row as it creates the twin and fills it, the drop removes the
 *    old one and the rename moves this one back, so no key the table already used is reused.
 * 3. Create the twin, `__new_<table>`, from the given definition.
 * 4. Copy the given columns into it.
 * 5. Drop the table, which takes its indexes and triggers with it, and rename the twin into place.
 * 6. Recreate the indexes, the table's own triggers, the views, then the other triggers, each from
 *    its stored SQL. Views and trigger bodies are bound by name, not by table identity, so they
 *    read the rebuilt table exactly as they read the old one.
 *
 * Steps 3 to 5 stay four adjacent statements of a fixed form: the ownership drop guard reads them
 * as a rebuild that keeps its table (`rebuildBlockStatements`), and anything placed between them
 * would make it read the drop as a drop. Steps 1, 2 and 6 render nothing when given nothing, so a
 * table no view or other trigger reads renders the four statements and its indexes alone.
 *
 * The inputs are plain data: this reads nothing, and every name is quoted here.
 *
 * @module domains/schema/pipeline/sql-templates/sqlite-swap
 */
import { quoteIdent } from "./identifier-quoting";

const q = (name: string): string => quoteIdent(name, "sqlite");

/** A SQL string literal, its quotes doubled. Shared by every SQLite statement built here. */
export const literalOf = (text: string): string =>
  `'${text.replace(/'/g, "''")}'`;

/** A schema object recreated by its stored SQL, and dropped by its name. */
interface SqliteStoredObject {
  name: string;
  sql: string;
}

/** What one swap needs: the table, its new definition, and what goes back on it afterwards. */
interface SqliteSwap {
  table: string;
  /**
   * Everything the new table's CREATE TABLE statement holds after the table's name: the
   * parenthesised column list and any table options after it (`STRICT`, `WITHOUT ROWID`).
   */
  definition: string;
  /** The columns copied from the old table into the new one, each by the same name. */
  columns: readonly string[];
  /** The table's indexes, as their CREATE INDEX statements. */
  indexes: readonly string[];
  /** The table's own triggers, as their CREATE TRIGGER statements. */
  triggers: readonly string[];
  /** The views that read the table, directly or through each other, in the order to create them. */
  views: readonly SqliteStoredObject[];
  /** Triggers on other tables or on those views that read the table or one of those views. */
  dependentTriggers?: readonly SqliteStoredObject[];
  /** Whether the table's key is AUTOINCREMENT, whose sequence the twin carries. */
  keepsSequence?: boolean;
}

/**
 * Whether this connection enforces foreign keys, as one value (1 or 0).
 *
 * A swap must run with them off: with them on, dropping the table runs each referencing table's
 * ON DELETE action (a CASCADE child loses its rows) or refuses on a RESTRICT one, and
 * `PRAGMA foreign_keys = OFF` inside a transaction is a no-op, so the transaction cannot turn them
 * off itself. Read by every guard that refuses a swap with them on.
 */
export const SQLITE_FOREIGN_KEYS_ENFORCED = `(SELECT "foreign_keys" FROM pragma_foreign_keys)`;

/**
 * Statements that refuse, before anything is dropped, when foreign keys are on: a one-row guard
 * table whose CHECK, named `refusal`, fails on insert with that message, then is dropped again.
 * They change nothing when foreign keys are off.
 */
export function sqliteForeignKeysOffGuard(
  table: string,
  refusal: string
): string[] {
  const guard = `__nextly_swap_${table}_guard`;
  return [
    `CREATE TABLE ${q(guard)} ("foreign_keys" INTEGER NOT NULL, CONSTRAINT ${q(refusal)} CHECK ("foreign_keys" = 0))`,
    `INSERT INTO ${q(guard)} ("foreign_keys") SELECT ${SQLITE_FOREIGN_KEYS_ENFORCED}`,
    `DROP TABLE ${q(guard)}`,
  ];
}

/** The statements that swap `swap.table` for a copy declared by `swap.definition`, in order. */
export function sqliteSwapStatements(swap: SqliteSwap): string[] {
  const twin = `__new_${swap.table}`;
  const columns = swap.columns.map(q).join(", ");
  const dependentTriggers = swap.dependentTriggers ?? [];
  return [
    ...dependentTriggers.map(trigger => `DROP TRIGGER ${q(trigger.name)}`),
    ...swap.views.map(view => `DROP VIEW ${q(view.name)}`),
    ...(swap.keepsSequence === true
      ? [
          `INSERT INTO sqlite_sequence (name, seq) SELECT ${literalOf(twin)}, seq ` +
            `FROM sqlite_sequence WHERE name = ${literalOf(swap.table)}`,
        ]
      : []),
    `CREATE TABLE ${q(twin)} ${swap.definition}`,
    `INSERT INTO ${q(twin)} (${columns}) SELECT ${columns} FROM ${q(swap.table)}`,
    `DROP TABLE ${q(swap.table)}`,
    `ALTER TABLE ${q(twin)} RENAME TO ${q(swap.table)}`,
    ...swap.indexes,
    ...swap.triggers,
    ...swap.views.map(view => view.sql),
    ...dependentTriggers.map(trigger => trigger.sql),
  ];
}
