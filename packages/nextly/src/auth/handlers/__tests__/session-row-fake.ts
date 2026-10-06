/**
 * An in-memory session-row transaction for handler unit tests.
 *
 * Records every operation in order, and keeps a row only when the work
 * returns: a throw from inside the transaction leaves `committed` as it was,
 * which is what a rollback does to the database.
 */
import { vi } from "vitest";

import type { AccountState } from "../../session/account-state";
import type { RefreshTokenRecord } from "../issue-session";
import type {
  SessionRowTransaction,
  WithSessionRowTransaction,
} from "../session-row";

export interface FakeSessionRows {
  withSessionRowTransaction: WithSessionRowTransaction;
  /** Every operation, in the order the transactions ran them. */
  calls: string[];
  /** The rows of every transaction that committed. */
  committed: RefreshTokenRecord[];
  lockAccountState: ReturnType<typeof vi.fn>;
  insertRefreshToken: ReturnType<typeof vi.fn>;
  consumeRefreshToken: ReturnType<typeof vi.fn>;
}

/**
 * @param readState - What the locked re-read of the user row returns.
 * @param consumes - What spending the presented row reports.
 */
export function fakeSessionRows(
  readState: (userId: string) => Promise<AccountState | null>,
  consumes: () => boolean = () => true
): FakeSessionRows {
  const calls: string[] = [];
  const committed: RefreshTokenRecord[] = [];
  // The rows the running transaction has inserted, kept on commit.
  let pending: RefreshTokenRecord[] = [];
  const lockAccountState = vi.fn(async (userId: string) => {
    calls.push("lock");
    return readState(userId);
  });
  const insertRefreshToken = vi.fn(async (record: RefreshTokenRecord) => {
    calls.push("insert");
    pending.push(record);
  });
  const consumeRefreshToken = vi.fn(async (_id: string) => {
    calls.push("consume");
    return consumes();
  });
  const tx: SessionRowTransaction = {
    lockAccountState,
    insertRefreshToken,
    consumeRefreshToken,
  };
  const withSessionRowTransaction: WithSessionRowTransaction = async work => {
    pending = [];
    try {
      const result = await work(tx);
      calls.push("commit");
      committed.push(...pending);
      return result;
    } catch (error) {
      calls.push("rollback");
      throw error;
    }
  };
  return {
    withSessionRowTransaction,
    calls,
    committed,
    lockAccountState,
    insertRefreshToken,
    consumeRefreshToken,
  };
}
