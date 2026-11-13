/**
 * Runs one field-group migration step in tries for a busy table.
 *
 * A step renames tables or a column and moves the pointers at them, in one transaction. Where a
 * table it renames is in use by another database session, the rename waits for that session's
 * lock, and every later read and write of the table waits behind it. So each try bounds that wait
 * with the database's own per-lock setting (PostgreSQL's `lock_timeout` for the transaction,
 * MySQL's `lock_wait_timeout` and `innodb_lock_wait_timeout` for the session, set back to the
 * values the session had before, SQLite's busy timeout), and a try whose wait ended is tried again
 * as the bounds allow, then the run stops with `NEXTLY_TABLE_BUSY`.
 *
 * The whole step runs again in each try, not its transaction alone: the step reads the catalog
 * before its transaction opens, so a try after a MySQL rename that committed renames only what is
 * still to rename. On PostgreSQL and SQLite a try that ended rolled its transaction back whole.
 *
 * The holder of the table is not looked up: the report says so, and names the table waited for.
 *
 * @module domains/field-groups/migration/step-tries
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SqlParam,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { is, Name, StringChunk, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import type { BusyTableBounds } from "../../schema/busy-table/bounds";
import { endedWaiting } from "../../schema/busy-table/ended-waiting";
import { firstNoRetry, targetTable } from "../../schema/busy-table/judge";
import { boundMysqlLockWaits } from "../../schema/busy-table/mysql-wait-bounds";
import { tableBusyError, tryNotice } from "../../schema/busy-table/report";
import { triggerTables } from "../../schema/busy-table/run-unit";
import { boundSqliteWait } from "../../schema/busy-table/session-try";
import {
  withBusyTableTries,
  type TryResult,
} from "../../schema/busy-table/tries";
import type {
  BusyTableStop,
  HolderReport,
} from "../../schema/busy-table/types";
import {
  assertSchemaLockHeld,
  schemaLockConfirmedUntil,
} from "../../schema/pipeline/schema-lock";

import type { MigrationStep } from "./runner";
import type { MigrationSession } from "./session";

/** How a run's steps wait for a busy table. */
export interface StepBusyTable {
  /** The adapter the steps run through; SQLite's busy timeout is set on it. */
  readonly adapter: DrizzleAdapter;
  readonly bounds: BusyTableBounds;
  /** Prints the line said at each try after a step's first. */
  readonly notify: (line: string) => void;
  /** What runs the steps, as the operator knows it: "nextly migrate:field-groups --apply (up)". */
  readonly command: string;
  /** Which way the run goes: `--down` rolls a completed migration back. */
  readonly direction: "up" | "down";
}

/** Why the report names no holder: this command does not look one up. */
const HOLDER_NOT_LOOKED_UP: HolderReport = {
  kind: "unnamed",
  reason:
    "nextly migrate:field-groups does not look up the session holding the table.",
};

/**
 * What to do once a step's tries ran out. The engine's report ends with the advice for a migration
 * file (`nextly migrate:resolve`, `--lock-timeout`), which this command has neither of: a step is
 * no migration file, and the command resumes from the step that stopped, re-reading the catalog,
 * so it is simply run again.
 */
function stepNextStep(stop: BusyTableStop, direction: "up" | "down"): string {
  const command = `nextly migrate:field-groups${direction === "down" ? " --down" : ""} --apply --backup-confirmed`;
  const committed =
    stop.outcome.kind === "part-way"
      ? "The step's statements that committed on MySQL before the wait stay; the next run reads " +
        "the catalog again and renames only what is left. "
      : stop.outcome.kind === "no-retry" && !stop.outcome.restUndone
        ? "What the step ran before the statement named above stays; the next run reads the " +
          "catalog again and renames only what is left. "
        : "";
  return (
    committed +
    `Run \`${command}\` again once the holder ends, or end the holding session: it resumes ` +
    "from the step that stopped. To wait longer, raise `NEXTLY_LOCK_TIMEOUT` / " +
    "`NEXTLY_LOCK_TIMEOUT_TOTAL`."
  );
}

/**
 * The error a step's tries stop with: the engine's report (`tableBusyError`), its code, reason and
 * stop as they are, with its last line, the next step, given for this command.
 */
export function stepTableBusyError(
  stop: BusyTableStop,
  direction: "up" | "down"
): NextlyError {
  const report = tableBusyError(stop);
  const lines = report.publicMessage.split("\n");
  lines[lines.length - 1] = stepNextStep(stop, direction);
  return new NextlyError({
    code: "NEXTLY_TABLE_BUSY",
    publicMessage: lines.join("\n"),
    ...(report.logContext === undefined
      ? {}
      : { logContext: report.logContext }),
  });
}

/** A statement a try sent, as text the busy-table judgement reads; never shown to an operator. */
interface SentStatement {
  readonly text: string;
  /** Whether it was a schema statement, which on MySQL commits what ran before it, and itself. */
  readonly schema: boolean;
}

/** Leading words of a statement a MySQL rollback undoes: a row change, a read or a setting. */
const ROW_CHANGE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|SELECT|SET)\b/i;

/** Leading words of a schema statement: one MySQL commits on its own. */
const SCHEMA_STATEMENT = /^\s*(ALTER|CREATE|DROP|RENAME)\b/i;

/** `name` quoted as `dialect` quotes an identifier, for a statement's stand-in text. */
function quoted(name: string, dialect: MigrationSession["dialect"]): string {
  return dialect === "mysql"
    ? `\`${name.replace(/`/g, "``")}\``
    : `"${name.replace(/"/g, '""')}"`;
}

/**
 * A Drizzle statement's leading words and first identifier ("UPDATE "dc_hero""), which is all the
 * judgement reads of a row change: its kind and its table. Empty where it starts any other way,
 * which the judgement counts as a statement it does not recognise, so the step is not tried again.
 */
function standInText(
  statement: SQL,
  dialect: MigrationSession["dialect"]
): string {
  let text = "";
  for (const chunk of statement.queryChunks) {
    if (is(chunk, StringChunk)) {
      text += chunk.value.join("");
      continue;
    }
    if (is(chunk, Name)) return `${text}${quoted(chunk.value, dialect)}`;
    return "";
  }
  return "";
}

/**
 * `ctx` with each statement it is asked to send recorded in `sent` before it is sent, so a try
 * that ended knows which statement waited and what ran before it.
 */
function recording(
  ctx: TransactionContext,
  dialect: MigrationSession["dialect"],
  sent: SentStatement[]
): TransactionContext {
  return new Proxy(ctx, {
    get(target, property, receiver) {
      if (property === "execute") {
        return <T = unknown>(text: string, params?: SqlParam[]) => {
          sent.push({ text, schema: SCHEMA_STATEMENT.test(text) });
          return target.execute<T>(text, params);
        };
      }
      if (property === "runStatement") {
        return (statement: SQL) => {
          sent.push({ text: standInText(statement, dialect), schema: false });
          return target.runStatement(statement);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * `session` for one try of `tryMs`: each transaction a step opens has its waits for a lock
 * bounded to the try, and records the statements it sends in `sent`.
 */
function boundedSession(
  session: MigrationSession,
  adapter: DrizzleAdapter,
  tryMs: number,
  sent: SentStatement[]
): MigrationSession {
  const { dialect } = session;
  return {
    ...session,
    inTransaction: async work => {
      // SQLite's wait comes as the transaction opens, for the database's one write lock, so the
      // busy timeout is set before it opens and put back after it ends.
      const restore =
        dialect === "sqlite"
          ? await boundSqliteWait(adapter, tryMs)
          : undefined;
      try {
        return await session.inTransaction(async ctx => {
          const recorded = recording(ctx, dialect, sent);
          if (dialect === "postgresql") {
            // Fixed text with a whole number of milliseconds; ends with the transaction.
            await ctx.execute(
              `SET LOCAL lock_timeout = '${String(Math.max(1, Math.round(tryMs)))}ms'`
            );
            return work(recorded);
          }
          if (dialect === "mysql") {
            // Both of MySQL's per-lock waits bounded to the try, put back afterwards to what the
            // session had (`boundMysqlLockWaits`).
            const restoreWaits = await boundMysqlLockWaits(
              {
                read: text => ctx.execute<Record<string, unknown>>(text),
                run: async text => {
                  await ctx.execute(text);
                },
              },
              tryMs / 1000
            );
            try {
              return await work(recorded);
            } finally {
              await restoreWaits();
            }
          }
          return work(recorded);
        });
      } finally {
        await restore?.();
      }
    },
  };
}

/**
 * Runs `step` in tries for a busy table (see the module's comment), as the change `change`, with
 * `appliedBefore` the steps this run applied before it. Throws `NEXTLY_TABLE_BUSY` once the tries
 * run out, or at once where the next try would send again a statement that may not be sent again;
 * every other failure of the step goes through as it is.
 */
export async function runStepInTries(
  step: MigrationStep,
  session: MigrationSession,
  busyTable: StepBusyTable,
  change: string,
  appliedBefore: readonly string[]
): Promise<void> {
  const { dialect } = session;
  const { adapter } = busyTable;
  // Numbered across the step's tries, so a statement a later try committed is not named by the
  // number of one an earlier try did.
  let committedEarlier = 0;
  await withBusyTableTries(
    {
      bounds: busyTable.bounds,
      change,
      appliedBefore,
      direction: busyTable.direction,
      notify: busyTable.notify,
      notice: tryNotice,
      assertHeld: assertSchemaLockHeld,
      stopped: stop => stepTableBusyError(stop, busyTable.direction),
      // On SQLite the holder's write lock keeps the schema lock from renewing while the tries
      // wait, so they end where the lock can still be shown held, and say why.
      ...(dialect === "sqlite"
        ? { leaseDeadline: schemaLockConfirmedUntil }
        : {}),
    },
    async (_tryNumber, tryMs): Promise<TryResult<undefined>> => {
      const sent: SentStatement[] = [];
      try {
        await step.run(boundedSession(session, adapter, tryMs, sent));
        return { kind: "done", value: undefined };
      } catch (error) {
        if (!endedWaiting(error, dialect, false)) throw error;
        // The statement that waited is the last one sent; none where the wait came as the
        // transaction opened (SQLite) or before any statement of the step.
        const waited = sent[sent.length - 1];
        // On MySQL a schema statement commits what ran before it before it waits, and itself once
        // it has run, so everything before the waiting statement is durable where that statement
        // is a schema statement, and everything up to the last one that ran where it is not; the
        // rest is rolled back. One that waited did not run. On PostgreSQL and SQLite the
        // transaction rolled back whole.
        const kept =
          dialect !== "mysql" || waited === undefined
            ? 0
            : waited.schema
              ? sent.length - 1
              : sent
                  .slice(0, -1)
                  .map(statement => statement.schema)
                  .lastIndexOf(true) + 1;
        const committed = Array.from(
          { length: kept },
          (_, index) => committedEarlier + index + 1
        );
        const keptEarlier = committedEarlier;
        committedEarlier += kept;
        // The next try runs again what was not kept, the waiting statement included.
        const again = sent.slice(kept).map(statement => statement.text);
        const lasting =
          again.length === 0
            ? undefined
            : firstNoRetry(
                again,
                dialect,
                await triggerTables(adapter, dialect).catch(
                  () => "unseen" as const
                )
              );
        return {
          kind: "ended",
          ended: {
            table:
              waited === undefined ? null : targetTable(waited.text, dialect),
            holder: HOLDER_NOT_LOOKED_UP,
          },
          ...(lasting === undefined
            ? {}
            : {
                lasting: {
                  statementNumber: keptEarlier + kept + lasting.statementNumber,
                  judgement: lasting.judgement,
                },
              }),
          // On PostgreSQL and SQLite the transaction rolled back whole. On MySQL the rest of the
          // step was undone only where the try kept nothing and sent no schema statement: every
          // statement it sent was a row change or a setting, which the rollback undid.
          undone:
            dialect !== "mysql" ||
            (kept === 0 &&
              sent.every(statement => ROW_CHANGE.test(statement.text))),
          committed,
        };
      }
    }
  );
}
