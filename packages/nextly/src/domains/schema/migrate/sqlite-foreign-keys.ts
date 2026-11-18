/**
 * SQLite's contract for changing a table's shape, shared by everything that
 * applies schema on SQLite: migration units (`executeTransaction`) and the
 * dev-push pipeline.
 *
 * Foreign-key enforcement is switched OFF for the unit, so a table rebuild
 * (`__new_x` created, rows copied, `x` dropped, `__new_x` renamed to `x`)
 * neither cascades into the rows of tables that reference `x` nor fails on
 * them. Once the unit's statements have run, `PRAGMA foreign_key_check` is
 * asked whether the unit left any row referencing a row that does not exist,
 * and such a unit is refused. Afterwards the setting in force before the unit is
 * restored, whatever happened.
 *
 * `PRAGMA foreign_keys` cannot change inside a transaction — the pragma is
 * silently ignored there — so the switch must happen before one is opened.
 *
 * @module domains/schema/migrate/sqlite-foreign-keys
 */
import { NextlyError } from "../../../errors/nextly-error";

/** The two ways a caller's connection runs SQL. */
export interface SqliteForeignKeySession {
  /** A statement that returns rows. */
  read<T>(statement: string): Promise<T[]>;
  /** A statement that returns none. */
  run(statement: string): Promise<void>;
}

/** Whether enforcement is on for the session's connection right now. */
export async function sqliteForeignKeysOn(
  session: Pick<SqliteForeignKeySession, "read">
): Promise<boolean> {
  const [row] = await session.read<{ foreign_keys: number }>(
    "PRAGMA foreign_keys"
  );
  return Number(row?.foreign_keys) !== 0;
}

/**
 * Runs `work` with foreign-key enforcement off, restoring the setting that
 * was in force before it — whether `work` returned or threw.
 */
export async function withSqliteForeignKeysOff<T>(
  session: SqliteForeignKeySession,
  work: () => Promise<T>
): Promise<T> {
  const wasOn = await sqliteForeignKeysOn(session);
  await session.run("PRAGMA foreign_keys = OFF");
  try {
    return await work();
  } finally {
    await session.run(`PRAGMA foreign_keys = ${wasOn ? "ON" : "OFF"}`);
  }
}

/** One dangling-reference count: rows of `table` pointing at missing `parent` rows. */
type DanglingCounts = Map<
  string,
  { table: string; parent: string; rows: number }
>;

/** One count of dangling rows through one foreign key, by its number in its table's key list. */
interface DanglingThroughKey {
  table: string;
  parent: string;
  /** The key's `id` in `PRAGMA foreign_key_list` of `table`. */
  key: number;
  rows: number;
}

/** The rows `PRAGMA foreign_key_check` reports, counted by the key each dangles through. */
async function danglingThroughKeys(
  session: Pick<SqliteForeignKeySession, "read">
): Promise<DanglingThroughKey[]> {
  const rows = await session.read<{
    table: string;
    parent: string;
    fkid: number;
  }>("PRAGMA foreign_key_check");
  const counts = new Map<string, DanglingThroughKey>();
  for (const row of rows) {
    const key = Number(row.fkid);
    const at = `${row.table}\u0000${row.parent}\u0000${key}`;
    const entry = counts.get(at) ?? {
      table: row.table,
      parent: row.parent,
      key,
      rows: 0,
    };
    entry.rows += 1;
    counts.set(at, entry);
  }
  return [...counts.values()];
}

/** The rows `PRAGMA foreign_key_check` reports, counted by table pair. */
async function danglingReferenceCounts(
  session: Pick<SqliteForeignKeySession, "read">
): Promise<DanglingCounts> {
  const counts: DanglingCounts = new Map();
  for (const { table, parent, rows } of await danglingThroughKeys(session)) {
    const key = `${table}\u0000${parent}`;
    const entry = counts.get(key) ?? { table, parent, rows: 0 };
    entry.rows += rows;
    counts.set(key, entry);
  }
  return counts;
}

/** The referencing columns of each foreign key of `table`, by the key's `id`, in key order. */
async function foreignKeyColumns(
  session: Pick<SqliteForeignKeySession, "read">,
  table: string
): Promise<Map<number, string[]>> {
  const rows = await session.read<{ id: number; seq: number; from: string }>(
    `PRAGMA foreign_key_list("${table.replace(/"/g, '""')}")`
  );
  const columns = new Map<number, string[]>();
  for (const row of [...rows].sort((a, b) => Number(a.seq) - Number(b.seq))) {
    const id = Number(row.id);
    columns.set(id, [...(columns.get(id) ?? []), row.from]);
  }
  return columns;
}

/**
 * The rows `PRAGMA foreign_key_check` reports, by table, the parent it references and the key the
 * rows dangle through, named by its referencing columns: what a check of the database as it
 * stands finds, for a caller judging a change it did not run. Two keys between the same two
 * tables are counted apart, so rows dangling through one are not laid on the other.
 */
export async function danglingReferences(
  session: Pick<SqliteForeignKeySession, "read">
): Promise<
  Array<{ table: string; parent: string; rows: number; columns: string[] }>
> {
  const found = await danglingThroughKeys(session);
  const keysOf = new Map<string, Map<number, string[]>>();
  for (const table of new Set(found.map(entry => entry.table))) {
    keysOf.set(table, await foreignKeyColumns(session, table));
  }
  return found.map(({ table, parent, key, rows }) => ({
    table,
    parent,
    rows,
    columns: keysOf.get(table)?.get(key) ?? [],
  }));
}

/**
 * Runs `work`, then refuses if it left MORE rows referencing rows that do not
 * exist than there were before it ran.
 *
 * Measured against a baseline rather than against zero, because a database
 * can already hold such rows — written while enforcement was off, or by an
 * older rebuild — and those are not this unit's doing. Refusing on them would
 * block every later migration, unrelated ones included, with a message
 * blaming the migration for rows it never touched.
 *
 * Compared as counts per (table, parent) rather than row by row: a rebuild
 * copies rows into a new table, which renumbers an implicit rowid and can
 * reorder the table's foreign keys, so a pre-existing dangling row would
 * otherwise come back looking new. The cost is that a unit which repairs one
 * dangling row and breaks another between the same two tables is not
 * refused; it has left the database no worse.
 *
 * `message` words the refusal around the new count and the offending table
 * pairs, because what became of the unit differs by caller — a migration is
 * rolled back, a dev push that ran without a transaction is not — and the
 * reader needs to know whether anything is left to repair.
 */
export async function refusingNewDanglingReferences<T>(
  session: Pick<SqliteForeignKeySession, "read">,
  work: () => Promise<T>,
  message: (count: number, pairs: string) => string
): Promise<T> {
  const before = await danglingReferenceCounts(session);
  const result = await work();
  const after = await danglingReferenceCounts(session);
  const added = [...after.entries()].flatMap(([key, entry]) => {
    const rows = entry.rows - (before.get(key)?.rows ?? 0);
    return rows > 0 ? [{ ...entry, rows }] : [];
  });
  if (added.length === 0) return result;
  throw new NextlyError({
    code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
    publicMessage: message(
      added.reduce((sum, entry) => sum + entry.rows, 0),
      added
        .slice(0, 5)
        .map(entry => `${entry.table} → ${entry.parent}`)
        .join(", ")
    ),
    logContext: { reason: "dangling-reference", added },
  });
}
