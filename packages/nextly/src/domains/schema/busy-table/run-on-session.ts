/**
 * Schema statements that are not a migration unit (`migrate:fresh`'s drops, `prune`'s drops, the
 * development start's table creation, an `upgrade` step's tables), run one at a time on one
 * connection, each committing as it runs, and each waiting for a busy table in its own tries.
 *
 * A statement whose wait ended did not apply: it is the one the next try sends again. The
 * statements before it committed as they ran, stay applied, and are never sent again. So each
 * statement is its own change to the tries: its own bounds, its own notices, and, where its tries
 * run out, its own report, which names what ran before it and the table it waited for, and says
 * nothing of it changed. Statements are named in a report by the names the caller gives them,
 * never by their text, which can hold a literal value.
 *
 * On PostgreSQL and MySQL the statements share one connection a session holds and closes
 * afterwards, its every lock wait bounded half a second past a try as a backstop
 * (`boundSessionTry`), and each try is watched from the pool (`watchTry`). On SQLite each try is
 * bounded by the busy timeout of the one connection, and the tries end where the schema lock can
 * still be shown held, since the holder of the database keeps it from renewing.
 *
 * @module domains/schema/busy-table/run-on-session
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SqlParam,
  StatementSession,
  SupportedDialect,
} from "@nextlyhq/adapter-drizzle/types";

import {
  assertSchemaLockHeld,
  schemaLockConfirmedUntil,
} from "../pipeline/schema-lock";

import type { BusyTableBounds } from "./bounds";
import {
  firstNoRetry,
  judgeStatement,
  targetTable,
  type JudgeContext,
  type StatementJudgement,
} from "./judge";
import { tableBusyError, tryNotice } from "./report";
import {
  ddlEventTriggerTags,
  eventTriggerContext,
  triggerTables,
} from "./run-unit";
import {
  boundSessionTry,
  boundSqliteWait,
  sentUnderSchemaLock,
} from "./session-try";
import { withBusyTableTries, type TryResult } from "./tries";
import { watchTry } from "./watched-try";

/** Settings the statements need on their connection, such as foreign-key checks switched off. */
export interface ConnectionSettings {
  /** Sent on the statements' connection before the first statement. */
  readonly set: (session: StatementSession) => Promise<void>;
  /** Sent on it after the last statement, or the one that stopped the run, whatever the outcome. */
  readonly restore: (session: StatementSession) => Promise<void>;
}

/** How a list of statements waits for a busy table, and how a report names it. */
export interface StatementsInTries {
  /** What runs the statements, as the operator knows it: "nextly migrate:fresh". */
  readonly change: string;
  readonly bounds: BusyTableBounds;
  /** Prints one line at each try after a statement's first. */
  readonly notify: (line: string) => void;
  /** What this run applied before these statements, as a report names it. */
  readonly appliedBefore: readonly string[];
  /**
   * What a report calls the statement at `index`, never its text: "the drop of table "posts"".
   * By default, its position: "statement 2 of 5".
   */
  readonly name?: (index: number) => string;
  readonly settings?: ConnectionSettings;
}

/**
 * How a statement is judged before it is sent again (`judgeStatement`). The catalog's triggers are
 * read only for a statement whose judgement asks about one (a row change), and only then: read
 * live, after the statements before it committed, they already carry any rename those made.
 */
async function judgedForResend(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  statement: string,
  eventTriggers: JudgeContext
): Promise<StatementJudgement> {
  let asksTriggers = false;
  const judgement = judgeStatement(statement, dialect, () => {
    asksTriggers = true;
    return true;
  });
  if (judgement.kind === "no-retry" && !asksTriggers) return judgement;
  // Judged as a unit's statements are (`firstNoRetry`): where the account cannot see every trigger
  // (`unseen`), any table may have one, so a row change fails closed as a hidden trigger; and a
  // schema statement that a DDL event trigger fires on may not be sent again.
  const triggers = asksTriggers
    ? await triggerTables(adapter, dialect)
    : new Set<string>();
  return (
    firstNoRetry([statement], dialect, triggers, eventTriggers)?.judgement ??
    judgeStatement(statement, dialect, () => false)
  );
}

/**
 * Runs `statements` in order, each committing as it runs, each in tries for a busy table (see the
 * module's comment), and returns what each ran statement is called in a report, in order, for a
 * later step's `appliedBefore`. Throws `NEXTLY_TABLE_BUSY` once a statement's tries run out, or at
 * once where the statement that waited may not be sent again; the statements before it stay
 * applied, and the report names them. Every other failure of a statement goes through as it is.
 */
export async function runStatementsInTries(
  adapter: DrizzleAdapter,
  statements: readonly string[],
  run: StatementsInTries
): Promise<readonly string[]> {
  const dialect = adapter.getCapabilities().dialect;
  const applied: string[] = [];
  if (statements.length === 0) return applied;
  // Read once, before the list's session holds a connection of the pool, so the read never waits
  // behind it; the statements here are Nextly's own, which make no event trigger.
  const eventTriggers = eventTriggerContext(
    await ddlEventTriggerTags(adapter, dialect)
  );
  const nameOf =
    run.name ??
    ((index: number) =>
      `statement ${String(index + 1)} of ${String(statements.length)}`);

  /** One statement, in its own tries, on the list's connection. */
  const statementInTries = (
    session: StatementSession,
    sessionId: string | undefined,
    statement: string,
    change: string
  ): Promise<void> =>
    withBusyTableTries(
      {
        bounds: run.bounds,
        change,
        appliedBefore: [...run.appliedBefore, ...applied],
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
      async (_tryNumber, tryMs): Promise<TryResult<undefined>> => {
        // A run that lost the schema lock sends nothing more.
        await assertSchemaLockHeld();
        // The session opens no transaction and binds no flow, so the watch's asks, made here,
        // still go to the pool, never to the session it watches.
        const watch = watchTry(adapter, dialect, tryMs);
        if (sessionId !== undefined) watch.onSession(sessionId);
        try {
          const sent = sentUnderSchemaLock(statement, dialect, run.change);
          if (dialect === "sqlite") {
            const restore = await boundSqliteWait(adapter, tryMs);
            try {
              await session.execute(sent);
            } finally {
              await restore();
            }
          } else {
            await session.execute(sent);
          }
          await watch.settle();
          return { kind: "done", value: undefined };
        } catch (error) {
          const holder = await watch.ended(error);
          if (holder === undefined) throw error;
          const judgement = await judgedForResend(
            adapter,
            dialect,
            statement,
            eventTriggers
          );
          return {
            kind: "ended",
            ended: { table: targetTable(statement, dialect), holder },
            // The change is this statement alone, so it is its statement 1.
            ...(judgement.kind === "no-retry"
              ? { lasting: { statementNumber: 1, judgement } }
              : {}),
            // A statement that waited did not apply, and nothing of it is left to undo.
            undone: false,
            committed: [],
          };
        }
      }
    );

  /** The statements on `session`, its id told to each try's watch where the database has one. */
  const onConnection = async (
    session: StatementSession,
    sessionId: string | undefined
  ): Promise<void> => {
    await run.settings?.set(session);
    try {
      for (const [index, statement] of statements.entries()) {
        const change = `${run.change}: ${nameOf(index)}`;
        await statementInTries(session, sessionId, statement, change);
        applied.push(change);
      }
    } finally {
      await run.settings?.restore(session);
    }
  };

  if (dialect === "sqlite") {
    // SQLite's one connection: what the adapter runs is already on it.
    await onConnection(
      {
        execute: <T = unknown>(statement: string, params?: SqlParam[]) =>
          adapter.executeQuery<T>(statement, params),
      },
      undefined
    );
    return applied;
  }
  await adapter.withSession(session => {
    let sessionId: string | undefined;
    return boundSessionTry(
      session,
      dialect,
      {
        tryMs: run.bounds.tryMs,
        onSession: id => {
          sessionId = id;
        },
      },
      () => onConnection(session, sessionId)
    );
  });
  return applied;
}
