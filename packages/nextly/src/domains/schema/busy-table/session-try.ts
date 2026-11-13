/**
 * How the connection a try for a busy table runs on is bounded, for every runner of such a try (a
 * migration unit, a list of autocommit statements): SQLite's busy timeout, the servers' per-lock
 * backstop with the session's id for the watch, and the schema lock's mark on each statement sent.
 *
 * @module domains/schema/busy-table/session-try
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  StatementSession,
  SupportedDialect,
} from "@nextlyhq/adapter-drizzle/types";

import { markedForSchemaLock } from "../pipeline/schema-lock";

import { ownSessionIdText, sessionIdOfRows } from "./ended-waiting";

/** What bounding a session needs of one try: its bound, and who to tell the session's id. */
export interface SessionTryBound {
  /** How long one try may wait for locks, in milliseconds. */
  readonly tryMs: number;
  /** Told the id of the session the try's statements run on, once it is known. */
  readonly onSession?: (session: string) => void;
}

/**
 * Sets SQLite's busy timeout to `tryMs` and returns what puts the connection's own back. Putting
 * it back is best effort: the work has already ended, and a failure here must not change how.
 */
export async function boundSqliteWait(
  adapter: Pick<DrizzleAdapter, "executeQuery">,
  tryMs: number
): Promise<() => Promise<void>> {
  const [row] = await adapter.executeQuery<Record<string, unknown>>(
    "PRAGMA busy_timeout"
  );
  const previous = Number(Object.values(row ?? {})[0] ?? 0);
  await adapter.executeQuery(
    `PRAGMA busy_timeout = ${String(Math.round(tryMs))}`
  );
  return () =>
    adapter
      .executeQuery(
        `PRAGMA busy_timeout = ${String(Number.isFinite(previous) ? previous : 0)}`
      )
      .then(
        () => undefined,
        () => undefined
      );
}

/**
 * Bounds each lock wait of a session that runs statements outside a transaction, half a second
 * past the try's bound, as a backstop for a watch that could not ask; and tells the try the
 * session's id, so the watch can follow it. The session is one `withSession` holds and closes
 * afterwards, so the setting ends with it; on PostgreSQL it is put back all the same, best effort,
 * before the session runs anything else.
 */
export async function boundSessionTry<T>(
  session: StatementSession,
  dialect: "postgresql" | "mysql",
  bound: SessionTryBound,
  work: () => Promise<T>
): Promise<T> {
  // Fixed text with a whole number of milliseconds or seconds, never caller input.
  await session.execute(
    dialect === "postgresql"
      ? `SET lock_timeout = '${String(Math.round(bound.tryMs) + 500)}ms'`
      : `SET SESSION lock_wait_timeout = ${String(Math.ceil((bound.tryMs + 500) / 1000))}`
  );
  const query = ownSessionIdText(dialect);
  const id =
    query === undefined
      ? undefined
      : sessionIdOfRows(await session.execute<Record<string, unknown>>(query));
  if (id !== undefined) bound.onSession?.(id);
  try {
    return await work();
  } finally {
    if (dialect === "postgresql") {
      await session.execute("RESET lock_timeout").then(
        () => undefined,
        () => undefined
      );
    }
  }
}

/**
 * `statement` as it is sent while the schema lock may be held: marked with the lock's claim on the
 * servers, where a run taking over a lapsed lock looks for an earlier holder's statements still
 * running; as it is on SQLite, which runs one writer at a time, so a taker cannot start while a
 * statement of the holder runs, and whose adapter reads a statement's first word. `unit` names
 * what the statement was sent for, so a run refused by it names that, never the statement's text.
 */
export function sentUnderSchemaLock(
  statement: string,
  dialect: SupportedDialect,
  unit: string
): string {
  return dialect === "sqlite"
    ? statement
    : markedForSchemaLock(statement, unit);
}
