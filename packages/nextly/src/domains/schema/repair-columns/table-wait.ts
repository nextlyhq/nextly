// How `nextly repair-columns` waits for a table another database session is using: the bounded,
// retried wait every schema change takes (`busy-table/`), for the run's reads of a table's rows
// and for its conversions alike, so a table has one kind of wait in a run.
//
// Each try waits once, at its start, and is bounded by one try's bound: a read first takes the
// table's shared lock (PostgreSQL `LOCK TABLE … IN ACCESS SHARE MODE`; on MySQL its first read
// takes the table's metadata lock, held to the end of its transaction), and a conversion's first
// statement is its wait. A try that ends waiting gives its claim on the table up, so no try holds
// another session's read or write of that table for longer than one try. The tries pause, grow
// and stop as the engine's schedule sets them, and the notice of each try after the first goes to
// `notify` (standard error), so a `--json` run keeps its one document on standard output.
//
// A table has one total in a run, shared by every wait for it: the read before the schema lock,
// the read under it and each conversion. Once its tries have run out, the run makes no further
// wait for it, and each of its columns not yet decided takes the locked-table outcome at once. On
// SQLite the thing another connection holds is the whole database, so its tries are the
// database's: once they run out, they have run out for every table.
//
// @module domains/schema/repair-columns/table-wait

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import type { BusyTableBounds } from "../busy-table/bounds";
import type { StatementJudgement } from "../busy-table/judge";
import { tryNotice } from "../busy-table/report";
import { boundSqliteWait } from "../busy-table/session-try";
import { withBusyTableTries } from "../busy-table/tries";
import type { BusyTableStop, HolderReport } from "../busy-table/types";
import { watchTry } from "../busy-table/watched-try";
import { executeTransaction } from "../migrate/migration-transaction";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import {
  assertSchemaLockHeld,
  schemaLockConfirmedUntil,
} from "../pipeline/schema-lock";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";
import type { SupportedDialect } from "../services/field-column-descriptor";

import type { TableHolder, TableLockFacts } from "./outcome";

/** What a wait for a table ended with: the work's value, or the lock that kept the table. */
export type Waited<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "ran-out"; readonly lock: TableLockFacts };

/** What one try is told: its bound, where to report its session, and how to end its watch. */
export interface TryContext {
  /** How long this try may wait for the table, in milliseconds. */
  readonly tryMs: number;
  /** Tells the try's watch the id of the session its statements run on. */
  readonly onSession: (session: string) => void;
  /**
   * Ends the try's watch. A try that runs on a connection it lets go (a transaction) calls it
   * before it does, so no cancel can reach the connection once another flow has it.
   */
  readonly settle: () => Promise<void>;
}

/** The statement a later try may not send again, by the engine's reading of it. */
export interface TryLasting {
  /** Its position in what the try runs (1 for the first); never its text. */
  readonly statementNumber: number;
  readonly judgement: Extract<StatementJudgement, { kind: "no-retry" }>;
}

export interface TableWaitsOptions {
  readonly adapter: DrizzleAdapter;
  readonly dialect: SupportedDialect;
  readonly bounds: BusyTableBounds;
  /** Prints one line on standard error at each try after the first. */
  readonly notify: (line: string) => void;
  /**
   * Whether the run holds the schema lock now: each try after the first shows it still does. An
   * apply that asks its questions first starts without it (`enterSchemaLock`).
   */
  readonly underSchemaLock: boolean;
  /** What the owner runs again, as the next step names it. */
  readonly command: string;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The tries a table has had in this run. */
interface TableState {
  /** Every try for it that ended waiting, over every wait, and the one its tries ran out at. */
  tries: number;
  /** How much of its total its waits have used, in milliseconds. */
  spentMs: number;
  /** What held it when its tries ran out; null while they have not. */
  ranOut: { holder: HolderReport; table: string } | null;
}

/**
 * The run no longer holds the schema lock, as a try after the first found: the run stops, rather
 * than let one column's failure stand for it while the others go on converting.
 */
export class SchemaLockLost extends Error {
  constructor(override readonly cause: unknown) {
    super("the run no longer holds the schema lock");
    this.name = "SchemaLockLost";
  }
}

/** Shows the run still holds the schema lock, or throws `SchemaLockLost`. */
async function assertStillHeld(): Promise<void> {
  try {
    await assertSchemaLockHeld();
  } catch (error) {
    throw new SchemaLockLost(error);
  }
}

/** Thrown by the tries' end, so the wait can tell its own stop from the work's failures. */
class TriesRanOut extends Error {
  constructor(readonly stop: BusyTableStop) {
    super("the tries for a busy table ran out");
  }
}

/** The key a table's tries are kept under: the table, or on SQLite the one database. */
const WHOLE_DATABASE = "";

/** What the run says of a holder that is SQLite's other connection: it holds every table. */
const SQLITE_HOLDER: TableHolder = {
  sessions: [],
  couldNotRead: {
    details: ["which connection holds the database"],
    why: "SQLite reports only that the database is locked, not who holds it",
  },
  wholeDatabase: true,
};

/** The engine's report of a holder, as the run's records carry it. */
export function tableHolderOf(
  report: HolderReport,
  dialect: SupportedDialect
): TableHolder {
  if (dialect === "sqlite") return SQLITE_HOLDER;
  if (report.kind === "unnamed") {
    return {
      sessions: [],
      couldNotRead: {
        details: ["which session holds the table"],
        why: report.reason,
      },
      wholeDatabase: false,
    };
  }
  return {
    sessions: report.sessions.map(session => ({
      id: session.id,
      user: session.user,
      clientAddress: session.clientAddress,
      application: session.applicationName,
      transactionOpenSeconds: session.transactionOpenSeconds,
    })),
    couldNotRead:
      report.unreadable.length === 0
        ? null
        : {
            details:
              report.sessions.length === 0
                ? ["which session holds the table"]
                : ["some of the holding sessions' details"],
            why: report.unreadable.join(" "),
          },
    wholeDatabase: false,
  };
}

/** The tries of one run, kept per table. */
export class TableWaits {
  private readonly states = new Map<string, TableState>();
  private readonly now: () => number;
  private underSchemaLock: boolean;

  constructor(private readonly options: TableWaitsOptions) {
    this.now = options.now ?? Date.now;
    this.underSchemaLock = options.underSchemaLock;
  }

  /** One try's bound, in milliseconds. */
  get tryMs(): number {
    return this.options.bounds.tryMs;
  }

  /** The run now holds the schema lock: the same tables, with what their waits have used. */
  enterSchemaLock(): void {
    this.underSchemaLock = true;
  }

  private key(table: string): string {
    return this.options.dialect === "sqlite"
      ? WHOLE_DATABASE
      : table.toLowerCase();
  }

  private stateOf(table: string): TableState {
    const key = this.key(table);
    let state = this.states.get(key);
    if (state === undefined) {
      state = { tries: 0, spentMs: 0, ranOut: null };
      this.states.set(key, state);
    }
    return state;
  }

  /** Whether another connection held the whole database past its tries (SQLite only). */
  wholeDatabaseHeld(): boolean {
    return (
      this.options.dialect === "sqlite" &&
      (this.states.get(WHOLE_DATABASE)?.ranOut ?? null) !== null
    );
  }

  /** The lock facts of `table` where its tries (on SQLite, the database's) have run out; else null. */
  ranOut(table: string): TableLockFacts | null {
    const state = this.states.get(this.key(table));
    return state?.ranOut == null ? null : this.factsOf(table, state);
  }

  private factsOf(table: string, state: TableState): TableLockFacts {
    const sqlite = this.options.dialect === "sqlite";
    const holder =
      state.ranOut === null
        ? SQLITE_HOLDER
        : tableHolderOf(state.ranOut.holder, this.options.dialect);
    return {
      table,
      tries: state.tries,
      waitedMs: state.spentMs,
      holder,
      nextStep: sqlite
        ? `run \`${this.options.command}\` again once the connection holding the database ends, end that connection, or raise --lock-timeout-total`
        : `run \`${this.options.command}\` again once the session using the table ends, end that session, or raise --lock-timeout-total`,
    };
  }

  /**
   * Run `attempt` for `table` in tries: at once with the table's lock facts where its tries have
   * already run out this run; otherwise until a try gets the table, or the table's total runs out.
   * `judge`, asked when a try ends waiting, names a statement the next try would send again that
   * may not run twice, which stops the tries at once. Every other failure of a try goes through
   * as it is.
   */
  async inTries<T>(
    table: string,
    attempt: (context: TryContext) => Promise<T>,
    judge?: () => Promise<TryLasting | undefined>
  ): Promise<Waited<T>> {
    const state = this.stateOf(table);
    if (state.ranOut !== null) {
      return { kind: "ran-out", lock: this.factsOf(table, state) };
    }
    const { adapter, dialect, bounds } = this.options;
    // One total per table per run: what earlier waits used is gone. A wait always gets one try.
    const left = Math.max(bounds.tryMs, bounds.totalMs - state.spentMs);
    const started = this.now();
    let lastStarted = started;
    let triedNow = 0;
    try {
      const value = await withBusyTableTries(
        {
          bounds: { tryMs: bounds.tryMs, totalMs: left },
          change: this.options.command,
          appliedBefore: [],
          notify: this.options.notify,
          notice: tryNotice,
          assertHeld: this.underSchemaLock
            ? assertStillHeld
            : () => Promise.resolve(),
          stopped: stop => new TriesRanOut(stop),
          // SQLite's holder keeps the schema lock from renewing while the tries wait, so under it
          // they end where it can still be shown held.
          ...(dialect === "sqlite" && this.underSchemaLock
            ? { leaseDeadline: schemaLockConfirmedUntil }
            : {}),
          ...(this.options.now === undefined ? {} : { now: this.options.now }),
          ...(this.options.sleep === undefined
            ? {}
            : { sleep: this.options.sleep }),
        },
        async (_tryNumber, tryMs) => {
          lastStarted = this.now();
          triedNow++;
          // Made before the try's connection runs anything, so its asks run on another one.
          const watch = watchTry(adapter, dialect, tryMs);
          let settled: Promise<void> | undefined;
          const settle = () => (settled ??= watch.settle());
          try {
            const value = await attempt({
              tryMs,
              onSession: id => watch.onSession(id),
              settle,
            });
            await settle();
            return { kind: "done" as const, value };
          } catch (error) {
            const holder = await watch.ended(error);
            if (holder === undefined) throw error;
            const lasting = await judge?.();
            return {
              kind: "ended" as const,
              ended: { table, holder },
              ...(lasting === undefined ? {} : { lasting }),
              // A try that ended waiting ran nothing that stays: a transaction rolled back, or a
              // statement that waited and so did not run.
              undone: true,
              committed: [],
            };
          }
        }
      );
      // The try that got the table waited at most its own bound, which is not counted, nor is it
      // a try the table's lock report counts.
      state.spentMs += lastStarted - started;
      state.tries += triedNow - 1;
      return { kind: "done", value };
    } catch (error) {
      state.spentMs += this.now() - started;
      state.tries += triedNow;
      if (!(error instanceof TriesRanOut)) throw error;
      state.ranOut = { holder: error.stop.ended.holder, table };
      return { kind: "ran-out", lock: this.factsOf(table, state) };
    }
  }

  /**
   * Run `work` over `table`'s rows in tries. Each try first takes the table's shared lock, its
   * one wait, bounded by the try, then reads on the same connection, so no later read of the try
   * waits. `work` receives the Drizzle handle the reads run through.
   */
  read<T>(
    table: string,
    work: (db: unknown) => Promise<T>
  ): Promise<Waited<T>> {
    const { adapter, dialect } = this.options;
    if (dialect === "sqlite") {
      return this.inTries(table, async ({ tryMs }) => {
        // In WAL mode a read waits only for a connection holding the database in exclusive
        // locking mode; the busy timeout bounds that wait to the try.
        const restore = await boundSqliteWait(adapter, tryMs);
        try {
          return await work(adapter.getDrizzle());
        } finally {
          await restore();
        }
      });
    }
    return this.inTries(table, ({ tryMs, onSession, settle }) =>
      executeTransaction(adapter, async tx => {
        const session = await tx.session();
        if (session !== undefined) onSession(session);
        // The watch ends the try at its bound; this backstop half a second past it holds where
        // the watch could not ask (a pool with no connection to spare).
        if (dialect === "postgresql") {
          await tx.execute(
            `SET LOCAL lock_timeout = '${String(Math.round(tryMs) + 500)}ms'`
          );
          // A table that does not exist has nothing to wait for, and LOCK TABLE would refuse it.
          const [found] = await querySqlRows<{ present: unknown }>(
            tx.db,
            dialect,
            sql`SELECT to_regclass(${quoteIdent(table, dialect)}) IS NOT NULL AS ${sql.identifier("present")}`
          );
          if (found?.present === true) {
            await tx.execute(
              `LOCK TABLE ${quoteIdent(table, dialect)} IN ACCESS SHARE MODE`
            );
          }
          return settledFirst(settle, () => work(tx.db));
        }
        // MySQL: a session setting outlives the transaction on its pooled connection, so both
        // waits (a table's metadata lock, a row's lock) are set back to the server's defaults
        // whatever the outcome.
        const seconds = String(Math.ceil((tryMs + 500) / 1000));
        await tx.execute(`SET SESSION lock_wait_timeout = ${seconds}`);
        await tx.execute(`SET SESSION innodb_lock_wait_timeout = ${seconds}`);
        try {
          return await settledFirst(settle, () => work(tx.db));
        } finally {
          for (const reset of [
            "SET SESSION lock_wait_timeout = DEFAULT",
            "SET SESSION innodb_lock_wait_timeout = DEFAULT",
          ]) {
            await tx.execute(reset).catch(() => undefined);
          }
        }
      })
    );
  }
}

/**
 * `work`, with the try's watch ended before its connection is let go, whether `work` ends well or
 * fails: a watch still running once the connection is back in the pool could end another flow's
 * statement on it. The watch keeps whether it ended the try's statement, which the try reads next.
 */
export async function settledFirst<T>(
  settle: () => Promise<void>,
  work: () => Promise<T>
): Promise<T> {
  try {
    const value = await work();
    await settle();
    return value;
  } catch (error) {
    await settle();
    throw error;
  }
}
