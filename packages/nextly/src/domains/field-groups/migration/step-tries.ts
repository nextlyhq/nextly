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

import type { BusyTableBounds } from "../../schema/busy-table/bounds";
import { endedWaiting } from "../../schema/busy-table/ended-waiting";
import { firstNoRetry, targetTable } from "../../schema/busy-table/judge";
import { tableBusyError, tryNotice } from "../../schema/busy-table/report";
import { triggerTables } from "../../schema/busy-table/run-unit";
import { boundSqliteWait } from "../../schema/busy-table/session-try";
import {
  withBusyTableTries,
  type TryResult,
} from "../../schema/busy-table/tries";
import type { HolderReport } from "../../schema/busy-table/types";
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
}

/** Why the report names no holder: this command does not look one up. */
const HOLDER_NOT_LOOKED_UP: HolderReport = {
  kind: "unnamed",
  reason:
    "nextly migrate:field-groups does not look up the session holding the table.",
};

/** A statement a try sent, as text the busy-table judgement reads; never shown to an operator. */
interface SentStatement {
  readonly text: string;
  /** Whether it was a schema statement, which on MySQL commits what ran before it, and itself. */
  readonly schema: boolean;
}

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

/** A whole number a session setting read back as, or undefined for anything else. */
function wholeNumber(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number)
    ? number
    : undefined;
}

/**
 * Runs `work` with MySQL's per-lock waits of the session bounded to `tryMs`, in whole seconds,
 * from 1: `lock_wait_timeout` for a table's metadata lock, `innodb_lock_wait_timeout` for a row's.
 * Both are session settings, which outlive the transaction on a pooled connection, so each is set
 * back to the value the session had before, whatever the outcome.
 */
async function withMysqlWaitBounds<T>(
  ctx: TransactionContext,
  tryMs: number,
  work: () => Promise<T>
): Promise<T> {
  const [row] = await ctx.execute<Record<string, unknown>>(
    "SELECT @@SESSION.lock_wait_timeout AS lock_wait, @@SESSION.innodb_lock_wait_timeout AS row_wait"
  );
  const before = {
    lock: wholeNumber(row?.lock_wait),
    row: wholeNumber(row?.row_wait),
  };
  const seconds = String(Math.max(1, Math.ceil(tryMs / 1000)));
  await ctx.execute(`SET SESSION lock_wait_timeout = ${seconds}`);
  await ctx.execute(`SET SESSION innodb_lock_wait_timeout = ${seconds}`);
  try {
    return await work();
  } finally {
    // Where a value could not be read, the server's default is the nearest to the session's own.
    const lock = before.lock === undefined ? "DEFAULT" : String(before.lock);
    const rows = before.row === undefined ? "DEFAULT" : String(before.row);
    await ctx
      .execute(`SET SESSION lock_wait_timeout = ${lock}`)
      .catch(() => undefined);
    await ctx
      .execute(`SET SESSION innodb_lock_wait_timeout = ${rows}`)
      .catch(() => undefined);
  }
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
            return withMysqlWaitBounds(ctx, tryMs, () => work(recorded));
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
      notify: busyTable.notify,
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
          // Only a transaction that kept nothing undid the rest of the step.
          undone: dialect !== "mysql",
          committed,
        };
      }
    }
  );
}
