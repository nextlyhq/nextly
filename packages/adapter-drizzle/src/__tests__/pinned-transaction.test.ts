/**
 * A pooled adapter's Drizzle transaction, on a connection the adapter checks
 * out and returns itself.
 *
 * Drizzle's own `transaction()` on a pool sends BEGIN outside its `try`, so a
 * failed BEGIN never returns the connection; and when its ROLLBACK fails it
 * hands the connection back to the pool as if nothing happened, and throws
 * the ROLLBACK's error in place of the work's. These tests hold the wrapper
 * to the opposite on each count, with a fake connection whose Drizzle
 * behaves as Drizzle does on a single connection.
 */
import { describe, expect, it } from "vitest";

import {
  pinTransactions,
  type DrizzleTransactor,
  type PinnedConnection,
} from "../pinned-transaction";

/** How the fake connection's statements go. */
interface Script {
  begin?: "fails";
  /** Drizzle's own ROLLBACK, after the work threw. */
  drizzleRollback?: "fails";
  /** The wrapper's ROLLBACK, after Drizzle's transaction rejected. */
  rollback?: "fails";
}

/** A connection that records what was sent on it and how it was returned. */
function fakeConnection(script: Script = {}): {
  connection: PinnedConnection;
  sent: string[];
  released: boolean[];
} {
  const sent: string[] = [];
  const released: boolean[] = [];
  const drizzle: DrizzleTransactor = {
    // Drizzle's transaction on one connection: BEGIN, the work, then COMMIT
    // or ROLLBACK, the ROLLBACK's failure replacing the work's error.
    async transaction(work) {
      sent.push("BEGIN");
      if (script.begin === "fails") throw new Error("begin failed");
      try {
        const result = await work("tx");
        sent.push("COMMIT");
        return result;
      } catch (error) {
        sent.push("ROLLBACK (drizzle)");
        if (script.drizzleRollback === "fails") {
          throw new Error("rollback failed");
        }
        throw error;
      }
    },
  };
  return {
    sent,
    released,
    connection: {
      drizzle,
      rollback: () => {
        sent.push("ROLLBACK");
        return script.rollback === "fails"
          ? Promise.reject(new Error("connection lost"))
          : Promise.resolve();
      },
      release: dirty => {
        released.push(dirty);
      },
    },
  };
}

/** A pool handle whose own transaction must never be used once pinned. */
function poolHandle(): DrizzleTransactor {
  return {
    transaction: () => Promise.reject(new Error("the pool's own transaction")),
  };
}

describe("a pinned Drizzle transaction", () => {
  it("commits the work on the checked-out connection and returns it clean", async () => {
    const fake = fakeConnection();
    const db = pinTransactions(poolHandle(), () =>
      Promise.resolve(fake.connection)
    );

    const result = await db.transaction(tx =>
      Promise.resolve(`ran on ${String(tx)}`)
    );

    expect(result).toBe("ran on tx");
    expect(fake.sent).toEqual(["BEGIN", "COMMIT"]);
    expect(fake.released).toEqual([false]);
  });

  it("rethrows the work's error and returns the connection clean when the rollback succeeds", async () => {
    const fake = fakeConnection();
    const db = pinTransactions(poolHandle(), () =>
      Promise.resolve(fake.connection)
    );
    const refusal = new Error("refused");

    await expect(db.transaction(() => Promise.reject(refusal))).rejects.toBe(
      refusal
    );
    expect(fake.released).toEqual([false]);
  });

  it("keeps the work's error, not the rollback's, when Drizzle's ROLLBACK fails", async () => {
    const fake = fakeConnection({ drizzleRollback: "fails" });
    const db = pinTransactions(poolHandle(), () =>
      Promise.resolve(fake.connection)
    );
    const refusal = new Error("refused");

    await expect(db.transaction(() => Promise.reject(refusal))).rejects.toBe(
      refusal
    );
  });

  it("closes the connection when no ROLLBACK can reach it", async () => {
    // Pooled, a connection that may still be inside the transaction would put
    // the next request's statements in a transaction nobody commits.
    const fake = fakeConnection({
      drizzleRollback: "fails",
      rollback: "fails",
    });
    const db = pinTransactions(poolHandle(), () =>
      Promise.resolve(fake.connection)
    );

    await expect(
      db.transaction(() => Promise.reject(new Error("refused")))
    ).rejects.toThrow("refused");
    expect(fake.released).toEqual([true]);
  });

  it("returns the connection when BEGIN fails, instead of leaking it", async () => {
    const fake = fakeConnection({ begin: "fails" });
    const db = pinTransactions(poolHandle(), () =>
      Promise.resolve(fake.connection)
    );

    await expect(
      db.transaction(() => Promise.resolve("never"))
    ).rejects.toThrow("begin failed");
    expect(fake.released).toHaveLength(1);
  });

  it("checks out a connection of its own for each transaction", async () => {
    const connections = [fakeConnection(), fakeConnection()];
    let next = 0;
    const db = pinTransactions(poolHandle(), () =>
      Promise.resolve(connections[next++].connection)
    );

    await db.transaction(() => Promise.resolve(1));
    await db.transaction(() => Promise.resolve(2));

    expect(connections.map(c => c.released)).toEqual([[false], [false]]);
  });
});
