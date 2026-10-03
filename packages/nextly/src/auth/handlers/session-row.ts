/**
 * The write that gives an account a session row, decided on fresh state.
 *
 * A sign-in and a refresh each read the account, then spend time on roles,
 * claims, plugin hooks and signing before the refresh row is written. A
 * revocation — a deactivation, or a password set by anyone — can commit in
 * that time: it updates the user row and deletes every refresh row the
 * account holds, and a row inserted after it survives the revocation it was
 * meant to be ended by.
 *
 * So the row is written inside one transaction that first locks the user row
 * and judges the account again on what it reads there. Every revocation
 * updates the user row before it deletes refresh rows, in a transaction of its
 * own, so the two serialise on the user row: a revocation that committed
 * first is seen by the re-read and refuses the session, and one that comes
 * after waits for this transaction to commit and then deletes the row it
 * wrote. On Postgres and MySQL the lock is `FOR SHARE`, which concurrent
 * sign-ins of one account share; SQLite's transaction opens with
 * `BEGIN IMMEDIATE`, which already serialises writers.
 *
 * @module auth/handlers/session-row
 */
import { auditReason } from "../../domains/audit/audit-reasons";
import { NextlyError } from "../../errors/nextly-error";
import { runAdapterTransaction } from "../../shared/lib/run-adapter-transaction";
import {
  assertAccountUsable,
  type AccountGateOptions,
  type AccountState,
} from "../session/account-state";

import type { RefreshTokenRecord } from "./issue-session";

/**
 * @experimental The operations a session-row write runs inside its one
 * transaction.
 */
export interface SessionRowTransaction {
  /**
   * Lock the account's user row for the rest of the transaction and read its
   * state from it. Null when the account no longer exists.
   */
  lockAccountState: (userId: string) => Promise<AccountState | null>;
  /** Insert a new refresh row. */
  insertRefreshToken: (record: RefreshTokenRecord) => Promise<void>;
  /**
   * Delete one refresh row by id and report whether this call removed it.
   * `false` means the row was already gone.
   */
  consumeRefreshToken: (id: string) => Promise<boolean>;
}

/**
 * @experimental Run `work` inside one database transaction, handing it the session-row
 * operations bound to that transaction. A throw from `work` rolls back every
 * write it made.
 */
export type WithSessionRowTransaction = <T>(
  work: (tx: SessionRowTransaction) => Promise<T>
) => Promise<T>;

/** What a session-row write needs to decide and to write. */
export interface SessionRowWrite {
  /** The new refresh row. */
  record: RefreshTokenRecord;
  /** The options the account-state gate judges the re-read state with. */
  gate: AccountGateOptions;
  /**
   * The password version the session was earned against: the value read when
   * the sign-in proved the password, or when the sign-in or refresh first
   * judged the account. A different value under the lock means the password
   * was set since, and the session is refused.
   */
  passwordUpdatedAt: Date | null;
  /**
   * The refresh row this write replaces, for a rotation. It is spent only
   * after the new row is in place, and only if this transaction is the one
   * that removes it.
   */
  consumeId?: string;
}

/**
 * - `written`: the new row is committed (and, for a rotation, the presented
 *   one spent).
 * - `consumed-elsewhere`: the presented row was already gone when this
 *   rotation tried to spend it — another request rotated it first. Nothing
 *   this call wrote is kept.
 */
export type SessionRowOutcome = "written" | "consumed-elsewhere";

/**
 * Judge the account on state read under the user-row lock, then insert the
 * new refresh row and, for a rotation, spend the presented one — in that
 * order, inside one transaction.
 *
 * @throws NextlyError `AUTH_INVALID_CREDENTIALS` when the account is gone, may
 *   no longer hold a session, or its password changed since
 *   `passwordUpdatedAt` was read. Nothing is written.
 */
export async function writeSessionRow(
  withTransaction: WithSessionRowTransaction,
  write: SessionRowWrite
): Promise<SessionRowOutcome> {
  // Thrown to roll the new row back when the presented row is already gone:
  // its token never leaves this request, and a row left behind would be a
  // session nobody holds. Recognised by identity, which holds because the
  // transaction hands back the error the work raised rather than its own
  // translation of it.
  const consumedElsewhere = NextlyError.conflict({
    logContext: { reason: "refresh-token-consumed-elsewhere" },
  });
  try {
    await runAdapterTransaction(withTransaction, async tx => {
      const state = await tx.lockAccountState(write.record.userId);
      assertSessionRowAllowed(state, write);
      await tx.insertRefreshToken(write.record);
      if (
        write.consumeId !== undefined &&
        !(await tx.consumeRefreshToken(write.consumeId))
      ) {
        throw consumedElsewhere;
      }
    });
  } catch (error) {
    if (error === consumedElsewhere) return "consumed-elsewhere";
    throw error;
  }
  return "written";
}

/**
 * The account-state gate over the state read under the lock, plus the
 * password version: a refusal here is a revocation that committed while the
 * session was being prepared.
 */
function assertSessionRowAllowed(
  state: AccountState | null,
  write: SessionRowWrite
): void {
  const userId = write.record.userId;
  if (!state) {
    throw NextlyError.invalidCredentials({
      logContext: { userId, reason: auditReason("user-not-found") },
    });
  }
  assertAccountUsable(state, write.gate);
  if (
    (state.passwordUpdatedAt?.getTime() ?? null) !==
    (write.passwordUpdatedAt?.getTime() ?? null)
  ) {
    throw NextlyError.invalidCredentials({
      logContext: { userId, reason: auditReason("password-changed") },
    });
  }
}
