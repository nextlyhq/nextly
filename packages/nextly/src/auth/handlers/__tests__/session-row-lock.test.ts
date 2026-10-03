/**
 * The bridge's session-row transaction: what it runs, on which handle, and
 * where it takes the user-row lock.
 *
 * Postgres and MySQL are not reachable from a unit run, so the statement each
 * dialect is sent is observed on a recording handle instead: the account read
 * is the one that locks, `FOR SHARE`, on the dialects with row locks, and
 * every operation runs on the transaction's own handle rather than the pool.
 */
import { describe, expect, it, vi } from "vitest";

import { buildAuthRouterDeps } from "../deps-bridge";

type Dialect = "postgresql" | "mysql" | "sqlite";

/** A Drizzle handle that records each statement it is sent. */
function recordingDb(state: Record<string, unknown> | null) {
  const sent: string[] = [];
  const rows = state ? [state] : [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          // Awaitable as-is, or locked with `.for(...)` — sent only when one
          // of the two is taken, as the query builder sends it.
          limit: () => ({
            then: (
              resolve: (value: unknown[]) => unknown,
              reject: (reason: unknown) => unknown
            ) => {
              sent.push("select");
              return Promise.resolve(rows).then(resolve, reject);
            },
            for: (strength: string) => {
              sent.push(`select for ${strength}`);
              return Promise.resolve(rows);
            },
          }),
        }),
      }),
    }),
    insert: () => ({
      values: async () => {
        sent.push("insert");
      },
    }),
    delete: () => ({
      where: async () => {
        sent.push("delete");
        return { rowCount: 1, changes: 1, affectedRows: 1 };
      },
    }),
  };
  return { db, sent };
}

function bridgeOver(dialect: Dialect, txDb: unknown) {
  // The pooled handle: building the deps reaches it for the plugin context,
  // but a statement sent on it would run outside the transaction.
  const outsideTransaction = () => {
    throw new Error("sent on the pool, outside the transaction");
  };
  const adapter = {
    getDrizzle: () => ({
      select: outsideTransaction,
      insert: outsideTransaction,
      delete: outsideTransaction,
    }),
    getCapabilities: () => ({ dialect }),
    transaction: vi.fn(
      async (work: (tx: { getDrizzle: () => unknown }) => Promise<unknown>) =>
        work({ getDrizzle: () => txDb })
    ),
  };
  const services: Record<string, unknown> = { adapter };
  const deps = buildAuthRouterDeps(name => services[name] ?? {});
  return { deps, adapter };
}

const record = {
  id: "rt-new",
  userId: "u1",
  tokenHash: "h",
  userAgent: null,
  ipAddress: null,
  expiresAt: new Date(),
};

describe("the bridge's session-row transaction", () => {
  it.each([
    ["postgresql", "select for share"],
    ["mysql", "select for share"],
    ["sqlite", "select"],
  ] as const)(
    "on %s, reads the account under the lock before writing",
    async (dialect, read) => {
      const { db, sent } = recordingDb({ userId: "u1", isActive: true });
      const { deps, adapter } = bridgeOver(dialect, db);

      await deps.withSessionRowTransaction(async tx => {
        await tx.lockAccountState("u1");
        await tx.insertRefreshToken(record);
        await tx.consumeRefreshToken("rt-presented");
      });

      expect(sent).toEqual([read, "insert", "delete"]);
      // Everything ran on the transaction's handle, inside one transaction.
      expect(adapter.transaction).toHaveBeenCalledOnce();
    }
  );
});
