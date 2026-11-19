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
 * changed nothing, and the next try runs the whole transaction again; unless the try ran code the
 * system does not know (a plugin's handler), whose effects outside the database a rollback does
 * not undo: then the delete stops at once, without trying again.
 *
 * MySQL commits each table drop as it runs, and what ran before it, so its deletes run in steps
 * ordered to stay retryable: the transaction runs there as before, unbounded.
 *
 * @module domains/collections/services/delete-transaction-tries
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { busyTableBounds } from "../../schema/busy-table/bounds";
import { endedWaiting } from "../../schema/busy-table/ended-waiting";
import { tableBusyError, tryNotice } from "../../schema/busy-table/report";
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
  return new NextlyError({
    code: report.code,
    publicMessage: [
      ...why,
      "Delete it again once the holding session ends, or end that session. To wait longer, " +
        "raise `NEXTLY_LOCK_TIMEOUT` / `NEXTLY_LOCK_TIMEOUT_TOTAL`.",
    ].join("\n"),
    ...(report.logContext === undefined
      ? {}
      : { logContext: report.logContext }),
  });
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
        // Rolled back whole: nothing of this try stays, and all of it may run again, unless it ran
        // code the system does not know, which runs first in the delete (its first step).
        return {
          kind: "ended",
          ended: { table: null, holder: HOLDER_NOT_LOOKED_UP },
          ...(options.ranUnknownCode?.() === true
            ? {
                lasting: {
                  statementNumber: 1,
                  judgement: { kind: "no-retry", reason: "unknown-code" },
                },
              }
            : {}),
          undone: true,
          committed: [],
        };
      } finally {
        await restore?.();
      }
    }
  );
}
