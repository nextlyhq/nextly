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
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { consoleLogger } from "../../../shared/types";

/** The two ways a caller's connection runs SQL. */
export interface SqliteForeignKeySession {
  /** A statement that returns rows. */
  read<T>(statement: string): Promise<T[]>;
  /** A statement that returns none. */
  run(statement: string): Promise<void>;
}

/** Whether enforcement is on for the session's connection right now. */
async function sqliteForeignKeysOn(
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

/**
 * Runs `work` as one change to SQLite's schema, in the adapter's own transaction, under SQLite's
 * contract for changing a table's shape. Migration units (`executeTransaction`) and the dev push
 * (`PushSchemaPipeline`) both run theirs through it.
 *
 * 1. `PRAGMA foreign_keys = OFF` before the transaction opens (inside one the pragma is silently
 *    ignored), after reading the setting in force.
 * 2. The adapter's transaction: queued behind every other flow's on the one connection, and begun
 *    IMMEDIATE, so the database's write lock is taken at the start, waiting the busy timeout for
 *    another writer, and nothing inside waits for it. Another flow's transaction waits its turn
 *    rather than beginning inside this one.
 * 3. Inside, the setting is read back; if enforcement is still on (another transaction was open on
 *    the connection, so the pragma did nothing) the change is refused before `work` runs.
 * 4. `work`, then `PRAGMA foreign_key_check`: a row it returns is a reference the change left
 *    dangling, and the change is rolled back and refused with `dangling`'s sentence.
 * 5. COMMIT, then the setting read in step 1 is restored, whether the change committed, was
 *    refused or failed. A restore that fails once the transaction has committed is thrown as a
 *    failure the change outlived (`restoreFailedAfterCommit`): the change stands, and only the
 *    setting could not be put back, which a reconnection does.
 *
 * `inside` wraps everything the transaction runs, where a caller reads its failures its own way.
 */
export function sqliteSchemaTransaction<T>(
  adapter: DrizzleAdapter,
  work: (ctx: TransactionContext) => Promise<T>,
  sentences: {
    /** What is refused where enforcement stays on, as "this migration". */
    readonly subject: string;
    /** The refusal of a change that would leave references dangling. */
    readonly dangling: (count: number, pairs: string) => string;
  },
  inside: <R>(run: () => Promise<R>) => Promise<R> = run => run()
): Promise<T> {
  // The adapter outside the transaction for the pragma switch, which SQLite ignores inside one;
  // the transaction's own connection for the reads that must see the change's state.
  const outside: SqliteForeignKeySession = {
    read: statement => adapter.executeQuery(statement),
    run: async statement => {
      await adapter.executeQuery(statement);
    },
  };
  let committed = false;
  return withSqliteForeignKeysOff(outside, async () => {
    const result = await adapter.transaction(ctx =>
      inside(async () => {
        const within = {
          read: <R>(statement: string) =>
            ctx.queryStatement<R>(sql.raw(statement)),
        };
        await assertForeignKeysOff(within, sentences.subject);
        return refusingNewDanglingReferences(
          within,
          () => work(ctx),
          sentences.dangling
        );
      })
    );
    committed = true;
    return result;
  }).catch((error: unknown) => {
    if (!committed) throw error;
    throw restoreFailureAfterCommit(sentences.subject, error);
  });
}

/** The failures `sqliteSchemaTransaction` raised for a restore after its transaction committed. */
const failedRestoresAfterCommit = new WeakSet<object>();

/**
 * Whether `error` is a restore of the foreign-key setting that failed after its schema change's
 * transaction committed: the change stands, so a caller reports it as landed, not taken back.
 */
export function restoreFailedAfterCommit(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    failedRestoresAfterCommit.has(error)
  );
}

/**
 * The failure of a restore after `subject`'s transaction committed, logged at once: until the
 * connection is opened again (as a restart does), enforcement may stay off for whatever runs next.
 */
function restoreFailureAfterCommit(
  subject: string,
  cause: unknown
): NextlyError {
  const failure = new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: `${subject.charAt(0).toUpperCase()}${subject.slice(1)} was applied, but foreign-key enforcement could not be switched back on after it. Restart the server before making further changes, so the database connection is opened again with enforcement on.`,
    logMessage: `The foreign-key setting could not be restored after ${subject} committed.`,
    logContext: { reason: "foreign-keys-not-restored-after-commit" },
    ...(cause instanceof Error ? { cause } : {}),
  });
  failedRestoresAfterCommit.add(failure);
  consoleLogger.error(failure.publicMessage, {
    reason: "foreign-keys-not-restored-after-commit",
    cause: cause instanceof Error ? cause.message : String(cause),
  });
  return failure;
}

/**
 * Runs `work` in one transaction on the session's own connection, for a caller with a database
 * handle and no adapter whose transaction it could take (`sqliteSchemaTransaction` is the path
 * wherever there is one): committed where it returns, rolled back where it or the commit throws.
 * Begun IMMEDIATE, as the adapter begins its own: the write lock is taken at the start, waiting the
 * busy timeout for another writer, so nothing inside waits for it.
 */
export async function withinSqliteTransaction<T>(
  session: Pick<SqliteForeignKeySession, "run">,
  work: () => Promise<T>
): Promise<T> {
  await session.run("BEGIN IMMEDIATE");
  try {
    const result = await work();
    await session.run("COMMIT");
    return result;
  } catch (error) {
    // A failure that already ended the transaction leaves none to roll back: the work's own
    // failure is what is thrown.
    await session.run("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/**
 * Refuses a change before its first statement when foreign-key enforcement is still on after it
 * was switched off: another transaction was open on SQLite's one connection, so the pragma did
 * nothing.
 */
export async function assertForeignKeysOff(
  session: Pick<SqliteForeignKeySession, "read">,
  subject: string
): Promise<void> {
  if (!(await sqliteForeignKeysOn(session))) return;
  throw new NextlyError({
    code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
    publicMessage: `Foreign-key enforcement could not be switched off for ${subject}, because another transaction was open on the connection. Nothing was applied; re-run it once that transaction has finished.`,
    logContext: { reason: "enforcement-still-on" },
  });
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

/** One foreign key's columns, in key order: its own, and the parent's it references. */
interface KeyColumns {
  columns: string[];
  /** Empty where the key names none: it references its parent's primary key. */
  referencesColumns: string[];
}

/** The columns of each foreign key of `table`, by the key's `id`. */
async function foreignKeyColumns(
  session: Pick<SqliteForeignKeySession, "read">,
  table: string
): Promise<Map<number, KeyColumns>> {
  const rows = await session.read<{
    id: number;
    seq: number;
    from: string;
    to: string | null;
  }>(`PRAGMA foreign_key_list("${table.replace(/"/g, '""')}")`);
  const keys = new Map<number, KeyColumns>();
  for (const row of [...rows].sort((a, b) => Number(a.seq) - Number(b.seq))) {
    const id = Number(row.id);
    const key = keys.get(id) ?? { columns: [], referencesColumns: [] };
    key.columns.push(row.from);
    if (typeof row.to === "string") key.referencesColumns.push(row.to);
    keys.set(id, key);
  }
  return keys;
}

/**
 * The rows `PRAGMA foreign_key_check` reports, by table, the parent it references and the key the
 * rows dangle through, named by its columns and the parent's it references: what a check of the
 * database as it stands finds, for a caller judging a change it did not run. Two keys between the
 * same two tables are counted apart, so rows dangling through one are not laid on the other.
 */
export async function danglingReferences(
  session: Pick<SqliteForeignKeySession, "read">
): Promise<
  Array<{
    table: string;
    parent: string;
    rows: number;
    columns: string[];
    referencesColumns: string[];
  }>
> {
  const found = await danglingThroughKeys(session);
  const keysOf = new Map<string, Map<number, KeyColumns>>();
  for (const table of new Set(found.map(entry => entry.table))) {
    keysOf.set(table, await foreignKeyColumns(session, table));
  }
  return found.map(({ table, parent, key, rows }) => ({
    table,
    parent,
    rows,
    columns: keysOf.get(table)?.get(key)?.columns ?? [],
    referencesColumns: keysOf.get(table)?.get(key)?.referencesColumns ?? [],
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
