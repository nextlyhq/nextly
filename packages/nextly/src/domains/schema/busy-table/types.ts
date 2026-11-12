/**
 * The shapes the busy-table tries share: what holds a table, how a try is watched, and what a run
 * that stopped waiting reports. Types only, so every part of the tries reads one definition.
 *
 * @module domains/schema/busy-table/types
 */
import type { NoRetryReason } from "./judge";

/** One database session that holds a lock a waiting statement needs. Never its query's text. */
export interface HolderSession {
  /** The database's id for the session: PostgreSQL's pid, MySQL's connection id. */
  readonly id: string;
  /** The database user it runs as, or null where it could not be read. */
  readonly user: string | null;
  /** The client address it connected from, or null where it could not be read or has none. */
  readonly clientAddress: string | null;
  /** The application name it set, or null where none was set or it could not be read. */
  readonly applicationName: string | null;
  /** How long its transaction has been open, in whole seconds, or null where unknown. */
  readonly transactionOpenSeconds: number | null;
}

/**
 * What the database says holds the table: each holding session it reports, with what could not be
 * read and why (a user without the right to see other sessions; MySQL's metadata-lock reporting
 * turned off); or, on SQLite, which names no holder, why none can be named.
 */
export type HolderReport =
  | {
      readonly kind: "named";
      readonly sessions: readonly HolderSession[];
      /** Each detail that could not be read, with the reason, in an operator's words. */
      readonly unreadable: readonly string[];
    }
  | { readonly kind: "unnamed"; readonly reason: string };

/**
 * A watch over one try's session that adds up the time it spends waiting for locks and ends the
 * statement once that reaches the try's bound, however many locks it waits for in turn.
 */
export interface TryWatchdog {
  /** Stops watching; says whether the watchdog ended the statement. */
  stop(): Promise<{ readonly fired: boolean }>;
}

/** What a try that ended waiting left, for the next try or the report. */
export interface EndedTry {
  /** The table the statement waited for, where the database names it; null where it does not. */
  readonly table: string | null;
  /** What holds it, read when the try ended. */
  readonly holder: HolderReport;
}

/** How a change that stopped waiting for a busy table stands, as the report says it. */
export type BusyTableOutcome =
  /** Nothing of the change is left: "table busy, nothing changed". */
  | { readonly kind: "nothing-changed" }
  /** Statements of the change had committed before the wait: they stay, named. */
  | { readonly kind: "part-way"; readonly committed: readonly string[] }
  /** A statement that may not be sent again ran or waited: the run stopped after one try. */
  | {
      readonly kind: "no-retry";
      readonly statement: string;
      readonly reason: NoRetryReason;
      /** Whether the rest of the change was undone with its transaction. */
      readonly restUndone: boolean;
    };

/** Everything the report of a stopped change names. */
export interface BusyTableStop {
  /** The change, as the operator knows it: a migration file, a down section. */
  readonly change: string;
  /** The last try's table and holder. */
  readonly ended: EndedTry;
  /** How many tries were made, and how long they took in all, in milliseconds. */
  readonly tries: number;
  readonly elapsedMs: number;
  /** The changes this run applied before this one, in order. */
  readonly appliedBefore: readonly string[];
  readonly outcome: BusyTableOutcome;
  /** "table busy", or "interrupted" where a signal ended the tries. */
  readonly cause: "table-busy" | "interrupted";
  /** On SQLite, whether the tries ended early because the schema lock could not be renewed. */
  readonly endedAtLease: boolean;
}
