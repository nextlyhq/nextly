/**
 * A migration unit (an app file, a down section) run in tries for a busy table: each try bounded
 * as `runMigrationStatements` bounds it, watched where the database needs a watch to bound the try
 * as a whole, judged when it ends, and reported when the tries stop.
 *
 * What an ended try keeps decides where the next starts (`TryKeeping`):
 *
 * - one transaction on PostgreSQL or SQLite keeps nothing, so the next try runs the unit from its
 *   start, while everything that ran may run again;
 * - one transaction on MySQL keeps every statement up to its last schema statement, whose implicit
 *   commit made it durable; the rest, the open transaction, was rolled back, and the next try runs
 *   it again from its first statement, while each statement of it may run again. A schema
 *   statement that waited is sent again alone: the commit before it made everything before it
 *   durable, and an InnoDB schema change that waited out its try did not run;
 * - a unit run outside a transaction keeps every statement before the one that waited, each having
 *   committed as it ran; the next try sends the waiting statement again, where it may run again.
 *
 * Statements a try kept are never sent again, and are reported by their position, never their
 * text.
 *
 * @module domains/schema/busy-table/run-unit
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { leadingWords } from "../migrate/split-sql";

import {
  runMigrationStatements,
  type MigrationUnit,
} from "../migrate/migration-transaction";
import {
  assertSchemaLockHeld,
  schemaLockConfirmedUntil,
} from "../pipeline/schema-lock";

import type { BusyTableBounds } from "./bounds";
import { endedWaiting } from "./ended-waiting";
import { readHolders } from "./holder";
import { firstNoRetry, renamedTables, targetTable } from "./judge";
import { tableBusyError, tryNotice } from "./report";
import { withBusyTableTries, type TryResult } from "./tries";
import type { HolderReport } from "./types";
import { prepareTryWatchdog } from "./watchdog";

/** What a run hands every unit it runs in tries. */
export interface BusyTableRun {
  readonly bounds: BusyTableBounds;
  /** Prints a line on standard error, so a `--json` run keeps one document on standard output. */
  readonly notify: (line: string) => void;
  /** The units this run applied before the one about to run. */
  readonly appliedBefore: () => readonly string[];
}

/** The tables of this database with a trigger a row change would fire. */
function triggerTablesQuery(dialect: SupportedDialect): SQL {
  if (dialect === "postgresql") {
    return sql`SELECT DISTINCT c.relname AS name FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal`;
  }
  if (dialect === "mysql") {
    return sql`SELECT DISTINCT EVENT_OBJECT_TABLE AS name FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()`;
  }
  return sql`SELECT DISTINCT tbl_name AS name FROM sqlite_master WHERE type = 'trigger'`;
}

/** The tables with a trigger, lower-cased; read once before a unit's first try. */
async function triggerTables(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<ReadonlySet<string>> {
  const rows = await adapter.queryStatement<{ name: unknown }>(
    triggerTablesQuery(dialect)
  );
  return new Set(rows.map(row => String(row.name).toLowerCase()));
}

/** What a try that ended keeps of a unit, by how the unit runs (see the module's comment). */
type TryKeeping = "rolled-back" | "open-transaction" | "each-statement";

function keepingOf(unit: MigrationUnit, dialect: SupportedDialect): TryKeeping {
  if (!unit.transaction) return "each-statement";
  return dialect === "mysql" ? "open-transaction" : "rolled-back";
}

/**
 * Whether MySQL commits the open transaction implicitly before and after `statement`: a CREATE,
 * ALTER, DROP or RENAME of a table or an index (the column, key and check changes are an
 * ALTER TABLE's). A temporary table's CREATE and DROP do not commit. A statement that commits but
 * is not read as one here (a view's CREATE, a TRUNCATE) is one no later try may send again
 * (`judgeStatement` reads it as unread), so the run stops rather than send it twice.
 */
function commitsOnMysql(statement: string): boolean {
  const [first, second, third] = leadingWords(statement, "mysql", 3);
  switch (first) {
    case "CREATE":
      return (
        second === "TABLE" ||
        second === "INDEX" ||
        ((second === "UNIQUE" ||
          second === "FULLTEXT" ||
          second === "SPATIAL") &&
          third === "INDEX")
      );
    case "ALTER":
    case "DROP":
      return second === "TABLE" || second === "INDEX";
    case "RENAME":
      return second === "TABLE";
    default:
      return false;
  }
}

/**
 * The index of the first statement an ended try did not keep, from the try's first (`from`) and
 * the index it was told last (`waiting`: the statement that waited, or the statements' count
 * where the wait came after the last).
 */
function keptUntil(
  keeping: TryKeeping,
  statements: readonly string[],
  from: number,
  waiting: number
): number {
  if (keeping === "rolled-back") return from;
  if (keeping === "each-statement") return waiting;
  // MySQL: a schema statement that waited had the transaction before it committed first.
  const waited = statements[waiting];
  if (waited !== undefined && commitsOnMysql(waited)) return waiting;
  for (let index = waiting - 1; index >= from; index--) {
    const statement = statements[index];
    if (statement !== undefined && commitsOnMysql(statement)) return index + 1;
  }
  return from;
}

/**
 * The first statement from `start` up to `end` (not included) that a later try may not send
 * again, by its position in the whole unit; `firstNoRetry`'s reading, with the tables the
 * statements before `start` renamed carried into it, since a renamed table keeps its triggers.
 * Only those renames are read before `start`: the statements there were kept and are not sent
 * again. A rename there that is itself one that may not run again (none is, as the statements
 * are read today) is named as the statement that stops the run, failing closed.
 */
function firstNoRetryBetween(
  statements: readonly string[],
  start: number,
  end: number,
  dialect: SupportedDialect,
  triggers: ReadonlySet<string>
): ReturnType<typeof firstNoRetry> {
  if (end <= start) return undefined;
  const renames: number[] = [];
  for (const [index, statement] of statements.slice(0, start).entries()) {
    const renamed = renamedTables(statement, dialect);
    if (renamed === "unread" || renamed.length > 0) renames.push(index);
  }
  const found = firstNoRetry(
    [
      ...renames.map(index => statements[index] ?? ""),
      ...statements.slice(start, end),
    ],
    dialect,
    triggers
  );
  if (found === undefined) return undefined;
  const at = found.statementNumber - 1;
  const index =
    at < renames.length ? (renames[at] ?? 0) : start + at - renames.length;
  return { statementNumber: index + 1, judgement: found.judgement };
}

/** The positions (1 for the first) of the statements from `from` up to `kept`, not included. */
function positionsBetween(from: number, kept: number): number[] {
  return Array.from(
    { length: Math.max(0, kept - from) },
    (_, i) => from + i + 1
  );
}

/**
 * Runs `unit`'s statements as `runMigrationStatements` does, in tries for a busy table: each try
 * starts where the one before stopped keeping (see the module's comment). Throws
 * `NEXTLY_TABLE_BUSY` once the tries run out, or at once where the next try would send a statement
 * that may not run again.
 */
export async function runUnitInTries(
  adapter: DrizzleAdapter,
  statements: readonly string[],
  unit: MigrationUnit,
  after: (db: unknown, statementsExecuted: number) => Promise<void>,
  run: BusyTableRun
): Promise<number> {
  const dialect = adapter.getCapabilities().dialect;
  const keeping = keepingOf(unit, dialect);
  const triggers = await triggerTables(adapter, dialect);
  // Where the next try starts: past every statement an earlier try kept.
  let from = 0;
  return withBusyTableTries(
    {
      bounds: run.bounds,
      change: unit.source,
      appliedBefore: run.appliedBefore(),
      notify: run.notify,
      notice: tryNotice,
      assertHeld: assertSchemaLockHeld,
      stopped: tableBusyError,
      // On SQLite the holder's write lock keeps the schema lock from renewing while the tries
      // wait, so they end where the lock can still be shown held, and say why.
      ...(dialect === "sqlite"
        ? { leaseDeadline: schemaLockConfirmedUntil }
        : {}),
    },
    async (_tryNumber, tryMs): Promise<TryResult<number>> => {
      let session: string | undefined;
      // The index last told: a statement about to be sent, or the count once all have run; -1
      // while none has been told.
      let reached = -1;
      // Made before the unit's transaction or session opens, so the watch's asks on another
      // connection never run inside that flow; it starts once the session is known.
      // What holds the table, read by the watch just before it ends the try, while the session
      // still waits; after the rollback it waits for nothing and the database names no holder.
      let holder: HolderReport | undefined;
      const watchdog = prepareTryWatchdog(adapter, dialect, tryMs, {
        beforeCancel: async waiting => {
          holder = await readHolders(adapter, dialect, waiting);
        },
      });
      try {
        const value = await runMigrationStatements(
          adapter,
          statements,
          unit,
          after,
          {
            tryMs,
            from,
            onSession: id => {
              session = id;
              watchdog.watch(id);
            },
            onStatement: index => {
              reached = index;
            },
          }
        );
        await watchdog.stop();
        return { kind: "done", value };
      } catch (error) {
        const { fired } = await watchdog.stop();
        if (!endedWaiting(error, dialect, fired)) throw error;
        const started = from;
        // Nothing of this try's own was sent where no index was told: a setting sent again first
        // waited, and the try kept nothing.
        const toldNone = reached < 0;
        const waiting = toldNone ? started : reached;
        const kept = toldNone
          ? started
          : keptUntil(keeping, statements, started, waiting);
        from = kept;
        // What the next try sends again from the statements this one ran: from its start where
        // the transaction kept nothing, from the open transaction's first on MySQL, the waiting
        // statement alone outside a transaction.
        const lasting = toldNone
          ? undefined
          : firstNoRetryBetween(
              statements,
              kept,
              Math.min(waiting + 1, statements.length),
              dialect,
              triggers
            );
        const waited = statements[Math.min(waiting, statements.length - 1)];
        return {
          kind: "ended",
          ended: {
            table: waited === undefined ? null : targetTable(waited, dialect),
            holder: holder ?? (await readHolders(adapter, dialect, session)),
          },
          ...(lasting === undefined ? {} : { lasting }),
          // Only a transaction that kept nothing undid the rest of the change.
          undone: keeping === "rolled-back",
          committed: positionsBetween(started, kept),
        };
      }
    }
  );
}
