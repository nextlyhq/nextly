/**
 * How the connection a try for a busy table runs on is bounded, for every runner of such a try (a
 * migration unit, a list of autocommit statements): SQLite's busy timeout, the servers' per-lock
 * backstop with the session's id for the watch, and the schema lock's mark on each statement sent.
 *
 * @module domains/schema/busy-table/session-try
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { markedForSchemaLock } from "../pipeline/schema-lock";

/** What bounding a session needs of one try: its bound, and who to tell the session's id. */
export interface SessionTryBound {
  /** How long one try may wait for locks, in milliseconds. */
  readonly tryMs: number;
  /** Told the id of the session the try's statements run on, once it is known. */
  readonly onSession?: (session: string) => void;
}

// One implementation: the session bounds a migration unit's tries use (SQLite's busy timeout;
// the servers' per-lock backstops, MySQL's row wait included, set back afterwards; the session's
// id told to the watch) are the ones every other runner of a try uses too.
export {
  boundSessionTry,
  boundSqliteWait,
} from "../migrate/migration-transaction";

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
