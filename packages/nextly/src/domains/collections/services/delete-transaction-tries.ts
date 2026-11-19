/**
 * An entity delete's one transaction (a collection's, a Single's, a field group's), run in tries
 * for a busy table.
 *
 * The delete drops tables and deletes rows another database session may hold: an open
 * transaction that has read the entity's translations table keeps its drop waiting, and every
 * later read and write of that table waits behind the drop. So each try bounds that wait with the
 * database's own per-lock setting (PostgreSQL's `lock_timeout` for the transaction, SQLite's busy
 * timeout), as a field-group migration step's tries do, and a try whose wait ended is tried again
 * as the bounds (`NEXTLY_LOCK_TIMEOUT`, `NEXTLY_LOCK_TIMEOUT_TOTAL`) allow; then the delete stops
 * with `NEXTLY_TABLE_BUSY`. A try that ended rolled its transaction back whole, so the stop has
 * changed nothing, and the next try runs the whole transaction again; unless the try may have run
 * code the system does not know, whose effects outside the database a rollback does not undo: a
 * plugin's handler, a row trigger, or on PostgreSQL a DDL event trigger on its drops. Then the
 * delete stops at once, without trying again, as the busy-table engine stops a change it judges
 * the same way.
 *
 * MySQL commits each table drop as it runs, and what ran before it, so its deletes run in steps
 * ordered to stay retryable: the transaction runs there as before, unbounded.
 *
 * @module domains/collections/services/delete-transaction-tries
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { busyTableBounds } from "../../schema/busy-table/bounds";
import { endedWaiting } from "../../schema/busy-table/ended-waiting";
import type { NoRetryReason } from "../../schema/busy-table/judge";
import { tableBusyError, tryNotice } from "../../schema/busy-table/report";
import {
  ddlEventTriggerTags,
  triggerTables,
} from "../../schema/busy-table/run-unit";
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

/** Why the report names no holder, nor the table: a delete looks up neither. */
const HOLDER_NOT_LOOKED_UP: HolderReport = {
  kind: "unnamed",
  reason: "a delete does not look up the session holding the table.",
};

/**
 * The stop's report (`tableBusyError`), its code and stop as they are, with its last line, the
 * next step, said for a delete: it has no `--lock-timeout` flag, and changed nothing.
 */
function deleteStopped(stop: BusyTableStop): NextlyError {
  const report = tableBusyError(stop);
  const why = report.publicMessage.split("\n").slice(0, -1);
  const again =
    "Delete it again once the holding session ends, or end that session.";
  return new NextlyError({
    code: report.code,
    publicMessage: [
      ...why,
      // Not tried again because what ran may have acted outside the database: deleting again runs
      // it again, so what it did is checked first.
      stop.outcome.kind === "no-retry"
        ? "What ran before the wait (a plugin's handler, or the database's own trigger or rule) " +
          "may have acted outside the database, which the rollback does not undo: check what it " +
          `did before you delete again. ${again}`
        : `${again} To wait longer, raise \`NEXTLY_LOCK_TIMEOUT\` / ` +
          "`NEXTLY_LOCK_TIMEOUT_TOTAL`.",
    ].join("\n"),
    ...(report.logContext === undefined
      ? {}
      : { logContext: report.logContext }),
  });
}

/**
 * Whether PostgreSQL has a rewrite rule on a table in the schemas an unqualified name reaches (a
 * view's own `_RETURN` rule is how it is defined, not code on a write): one runs with the
 * statements on its table, as a trigger does. False on the other dialects, which have none. A read
 * that fails answers yes, failing closed.
 */
async function hasRewriteRules(
  adapter: DrizzleAdapter,
  dialect: "postgresql" | "sqlite"
): Promise<boolean> {
  if (dialect !== "postgresql") return false;
  try {
    const rows = await adapter.queryStatement<{ seen: unknown }>(
      sql`SELECT 1 AS seen FROM pg_rewrite r
        JOIN pg_class c ON c.oid = r.ev_class
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE r.rulename <> '_RETURN' AND c.relkind IN ('r', 'p')
          AND n.nspname = ANY (current_schemas(false))
        LIMIT 1`
    );
    return rows.length > 0;
  } catch {
    return true;
  }
}

/**
 * The database's own code a delete's try may run, as a reason it may not run again, or undefined
 * where there is none. A delete drops tables and changes rows across many tables (registry rows,
 * the rows it sweeps, field-group values), so this is asked of the database as a whole rather than
 * of each statement: on PostgreSQL a DDL event trigger that fires on `DROP TABLE`, or a rewrite
 * rule on a table; any row trigger, or triggers this account cannot all see. Each read that fails
 * answers no-retry, failing closed: what is lost is only the retry, and the delete changed nothing.
 */
async function databaseCodeOf(
  adapter: DrizzleAdapter,
  dialect: "postgresql" | "sqlite"
): Promise<NoRetryReason | undefined> {
  const tags = await ddlEventTriggerTags(adapter, dialect);
  if (tags === "all" || (tags !== "none" && tags.has("DROP TABLE"))) {
    return "event-trigger";
  }
  // A rule's call is code the system does not know, named as such in the stop.
  if (await hasRewriteRules(adapter, dialect)) return "unknown-code";
  const triggers = await triggerTables(adapter, dialect).catch(
    () => "unseen" as const
  );
  return triggers === "unseen" || triggers.size > 0 ? "trigger" : undefined;
}

/**
 * Runs `work` in one transaction of `adapter`, as `adapter.transaction` does, in tries for a busy
 * table on PostgreSQL and SQLite (see the module's comment); `change` names the delete in each
 * try's notice, told through `warn`, and in the stop. Throws `NEXTLY_TABLE_BUSY` once the tries
 * run out, at once where the try that ended ran code the system does not know
 * (`options.ranUnknownCode`), and `INVALID_INPUT` for a bound out of range before the first; every
 * other failure of `work` goes through as it is.
 */
export async function deleteTransactionInTries<T>(
  adapter: DrizzleAdapter,
  change: string,
  warn: (line: string) => void,
  work: (tx: TransactionContext) => Promise<T>,
  options: {
    /**
     * Whether the try just ended ran code the system does not know, which a next try would run
     * again: asked once a try's wait has ended, of what that try's `work` ran.
     */
    ranUnknownCode?: () => boolean;
  } = {}
): Promise<T> {
  const { dialect } = adapter.getCapabilities();
  if (dialect === "mysql") return adapter.transaction(work);
  // Read before the first try, as the busy-table engine reads its trigger catalog, and kept: code
  // that stood when a try began may have run in it even where it is gone once the try has ended.
  const codeBefore = await databaseCodeOf(adapter, dialect);
  return withBusyTableTries(
    {
      bounds: busyTableBounds({ env: process.env }),
      change,
      appliedBefore: [],
      notify: warn,
      notice: tryNotice,
      assertHeld: assertSchemaLockHeld,
      stopped: deleteStopped,
      // On SQLite the holder's write lock keeps the schema lock from renewing while the tries
      // wait, so they end where the lock can still be shown held.
      ...(dialect === "sqlite"
        ? { leaseDeadline: schemaLockConfirmedUntil }
        : {}),
    },
    async (_tryNumber, tryMs): Promise<TryResult<T>> => {
      // SQLite's wait comes as the transaction opens, for the database's one write lock, so the
      // busy timeout is set before it opens and put back after it ends.
      const restore =
        dialect === "sqlite"
          ? await boundSqliteWait(adapter, tryMs)
          : undefined;
      try {
        const value = await adapter.transaction(async tx => {
          if (dialect === "postgresql") {
            // Fixed text with a whole number of milliseconds; ends with the transaction.
            await tx.execute(
              `SET LOCAL lock_timeout = '${String(Math.max(1, Math.round(tryMs)))}ms'`
            );
          }
          return work(tx);
        });
        return { kind: "done", value };
      } catch (error) {
        if (!endedWaiting(error, dialect, false)) throw error;
        // Rolled back whole: nothing of this try stays, and all of it may run again, unless it may
        // have run code the system does not know, from its first step on: a plugin's handler that
        // ran, or the database's own code as it stood before the first try or stands now.
        const reason =
          options.ranUnknownCode?.() === true
            ? "unknown-code"
            : (codeBefore ?? (await databaseCodeOf(adapter, dialect)));
        return {
          kind: "ended",
          ended: { table: null, holder: HOLDER_NOT_LOOKED_UP },
          ...(reason === undefined
            ? {}
            : {
                lasting: {
                  statementNumber: 1,
                  judgement: { kind: "no-retry", reason },
                },
              }),
          undone: true,
          committed: [],
        };
      } finally {
        await restore?.();
      }
    }
  );
}
