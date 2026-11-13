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
  isConnectionSetting,
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
import {
  firstNoRetry,
  renamedTables,
  targetTable,
  type StatementJudgement,
  type TriggerTables,
} from "./judge";
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
  /**
   * A statement whose failure this accepts is passed over and counts as run (a runner that
   * tolerates a statement already applied); see `StatementTryBound.passOver` for where it is
   * honoured.
   */
  readonly passOver?: (error: unknown, statement: string) => boolean;
}

/** The tables of this database with a trigger a row change would fire. */
function triggerTablesQuery(dialect: SupportedDialect): SQL {
  if (dialect === "postgresql") {
    // Only the schemas an unqualified name reaches: a trigger on a same-named table elsewhere is
    // not this table's.
    return sql`SELECT DISTINCT c.relname AS name FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = ANY (current_schemas(false))`;
  }
  if (dialect === "mysql") {
    return sql`SELECT DISTINCT EVENT_OBJECT_TABLE AS name FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()`;
  }
  return sql`SELECT DISTINCT tbl_name AS name FROM sqlite_master WHERE type = 'trigger'`;
}

/**
 * Whether this MySQL account holds `TRIGGER` on the whole database, globally or on its schema:
 * MySQL lists a table's triggers only to an account holding `TRIGGER` on that table, while a row
 * change still fires them. Read from the privilege tables the account sees of its own grants. A
 * grant this does not find (on single tables, through a role, by a schema pattern) answers no,
 * which only makes the reading more cautious.
 */
function mysqlSeesEveryTriggerQuery(): SQL {
  // `CURRENT_USER()` is `name@host`; the privilege tables name the grantee as `'name'@'host'`.
  const grantee = sql`CONCAT('''', SUBSTRING_INDEX(CURRENT_USER(), '@', 1), '''@''', SUBSTRING_INDEX(CURRENT_USER(), '@', -1), '''')`;
  return sql`SELECT 1 AS seen FROM information_schema.USER_PRIVILEGES
      WHERE PRIVILEGE_TYPE = 'TRIGGER' AND GRANTEE = ${grantee}
    UNION ALL
    SELECT 1 AS seen FROM information_schema.SCHEMA_PRIVILEGES
      WHERE PRIVILEGE_TYPE = 'TRIGGER' AND TABLE_SCHEMA = DATABASE() AND GRANTEE = ${grantee}`;
}

/**
 * The tables with a trigger, lower-cased; read once before a unit's first try. On MySQL, `"unseen"`
 * unless the account can see every trigger of the database: a table missing from the list could
 * still have one, so the list is trusted only where it is whole.
 */
export async function triggerTables(
  adapter: Pick<DrizzleAdapter, "queryStatement">,
  dialect: SupportedDialect
): Promise<TriggerTables> {
  if (dialect === "mysql") {
    const seen = await adapter.queryStatement<{ seen: unknown }>(
      mysqlSeesEveryTriggerQuery()
    );
    if (seen.length === 0) return "unseen";
  }
  const rows = await adapter.queryStatement<{ name: unknown }>(
    triggerTablesQuery(dialect)
  );
  return new Set(rows.map(row => String(row.name).toLowerCase()));
}

/**
 * Whether `statement` makes state of its own session alone, which a statement on another session
 * cannot see and which ends with the session: a temporary table (or view or sequence), a prepared
 * statement, a cursor. A connection setting (`SET`) is not one: the next try sends it again
 * (`isConnectionSetting`).
 */
export function makesSessionState(
  statement: string,
  dialect: SupportedDialect
): boolean {
  const [first, second, third] = leadingWords(statement, dialect, 3);
  if (first === "PREPARE" || first === "DECLARE") return true;
  if (first !== "CREATE") return false;
  // PostgreSQL's `CREATE GLOBAL|LOCAL TEMP|TEMPORARY`: the scope word comes first.
  const kind = second === "GLOBAL" || second === "LOCAL" ? third : second;
  return kind === "TEMP" || kind === "TEMPORARY";
}

/**
 * The first statement before `start` that made state of its own session, as a judgement that
 * stops the run: those statements were kept and are not sent again, yet the next try runs on a
 * new session, which does not have what they made. Not on SQLite, whose one connection the next
 * try runs on too.
 */
function sessionStateBefore(
  statements: readonly string[],
  start: number,
  dialect: SupportedDialect
):
  | {
      readonly statementNumber: number;
      readonly judgement: Extract<StatementJudgement, { kind: "no-retry" }>;
    }
  | undefined {
  // Nothing left to send: the next try writes only the ledger, which needs no session state.
  if (dialect === "sqlite" || start >= statements.length) return undefined;
  const index = statements
    .slice(0, start)
    .findIndex(statement => makesSessionState(statement, dialect));
  if (index < 0) return undefined;
  return {
    statementNumber: index + 1,
    judgement: { kind: "no-retry", reason: "session-state" },
  };
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
  const objects = MYSQL_COMMITTING[first ?? ""];
  if (objects === undefined) return false;
  // `CREATE UNIQUE|FULLTEXT|SPATIAL INDEX`: the object is the third word.
  const object =
    first === "CREATE" && INDEX_KINDS.has(second ?? "") ? third : second;
  return objects.has(object ?? "");
}

/** The objects whose creation, change, drop or rename commits MySQL's transaction, by verb. */
const MYSQL_COMMITTING: Readonly<Record<string, ReadonlySet<string>>> = {
  CREATE: new Set(["TABLE", "INDEX"]),
  ALTER: new Set(["TABLE", "INDEX"]),
  DROP: new Set(["TABLE", "INDEX"]),
  RENAME: new Set(["TABLE"]),
};

/** The kinds of index MySQL writes before `INDEX`. */
const INDEX_KINDS = new Set(["UNIQUE", "FULLTEXT", "SPATIAL"]);

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
 * statements before `start` renamed carried into it, since a renamed table keeps its triggers,
 * and the connection settings before `start` judged too, since the next try sends them again
 * first (`SET @x = site_fn()` would run its function twice). Only those are read before `start`:
 * the other statements there were kept and are not sent again. A rename or a setting there that
 * may not run again is named as the statement that stops the run, failing closed.
 */
function firstNoRetryBetween(
  statements: readonly string[],
  start: number,
  end: number,
  dialect: SupportedDialect,
  triggers: TriggerTables
): ReturnType<typeof firstNoRetry> {
  // Asked first, whatever the next try sends: it runs on a new session either way.
  const sessionState = sessionStateBefore(statements, start, dialect);
  if (sessionState !== undefined) return sessionState;
  if (end <= start) return undefined;
  const replayedBefore: number[] = [];
  for (const [index, statement] of statements.slice(0, start).entries()) {
    const renamed = renamedTables(statement, dialect);
    if (
      renamed === "unread" ||
      renamed.length > 0 ||
      isConnectionSetting(statement, dialect)
    ) {
      replayedBefore.push(index);
    }
  }
  const found = firstNoRetry(
    [
      ...replayedBefore.map(index => statements[index] ?? ""),
      ...statements.slice(start, end),
    ],
    dialect,
    triggers
  );
  if (found === undefined) return undefined;
  const at = found.statementNumber - 1;
  const index =
    at < replayedBefore.length
      ? (replayedBefore[at] ?? 0)
      : start + at - replayedBefore.length;
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
              // The watch cancels only the statement it saw waiting, never a later one.
              watchdog.moveTo(index);
            },
            // The watch stops before the commit hands the connection back to the pool.
            settle: async () => {
              await watchdog.stop();
            },
            beforeStatement: () => watchdog.idle(),
            ...(run.passOver === undefined ? {} : { passOver: run.passOver }),
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
        // A try that sent none of its own still leaves the next on a new session, without the
        // state the statements kept before it made.
        const lasting = toldNone
          ? sessionStateBefore(statements, kept, dialect)
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
