/**
 * A code and the one that replaces it never stand in for each other.
 *
 * Six digits repeat about once in a million resends. A holder of the earlier
 * code could then spend its successor, with a fresh budget of tries, so a draw
 * that repeats the live code is drawn again. A code is derived from its row's
 * id, so the id source is held to a repeat here, which a real one produces
 * too rarely to test.
 *
 * An attempt that loses its write to a replacing mint is not judged, or
 * charged, against the replacement. The race is placed exactly with a hook on
 * the attempt's write, which a real database orders too rarely to test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOneTimeSecrets } from "../one-time-secrets";

const draws = vi.hoisted(() => ({ queue: [] as string[], calls: 0 }));

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: () => {
      draws.calls++;
      return draws.queue.shift() ?? actual.randomUUID();
    },
  };
});

afterEach(() => {
  draws.queue = [];
  draws.calls = 0;
});

type Row = Record<string, unknown>;
type Condition = { column: string; op: string; value?: unknown };

/** Rows in memory, answering the few queries the helper makes. */
function memoryAdapter() {
  const rows: Row[] = [];
  // Run once, just before the next write that charges or spends a code.
  const beforeCodeWrite: { run?: () => Promise<void> } = {};
  const matches = (row: Row, where?: { and?: Condition[] }) =>
    (where?.and ?? []).every(condition =>
      condition.op === "="
        ? row[condition.column] === condition.value
        : condition.op === "IS NULL"
          ? row[condition.column] == null
          : true
    );
  const tx = {
    select: async (
      _table: string,
      options: {
        where?: { and?: Condition[] };
        orderBy?: { column: string; direction: "asc" | "desc" }[];
        limit?: number;
      }
    ) => {
      let found = rows.filter(row => matches(row, options.where));
      const order = options.orderBy?.[0];
      if (order) {
        found = [...found].sort(
          (a, b) =>
            (Number(a[order.column] ?? 0) - Number(b[order.column] ?? 0)) *
            (order.direction === "desc" ? -1 : 1)
        );
      }
      return found.slice(0, options.limit ?? found.length);
    },
    insert: async (_table: string, row: Row) => {
      rows.push({ ...row });
    },
    updateCount: async (
      _table: string,
      set: Row,
      where: { and?: Condition[] }
    ) => {
      if (beforeCodeWrite.run && ("wrongTries" in set || "spentAt" in set)) {
        const run = beforeCodeWrite.run;
        beforeCodeWrite.run = undefined;
        await run();
      }
      const hit = rows.filter(row => matches(row, where));
      for (const row of hit) Object.assign(row, set);
      return hit.length;
    },
  };
  return {
    rows,
    beforeCodeWrite,
    adapter: {
      ...tx,
      transaction: async (work: (handle: typeof tx) => Promise<unknown>) =>
        work(tx),
      transactionOpenInFlow: () => false,
    },
  };
}

describe("a replacement code", () => {
  it("is drawn again when it would repeat the live code", async () => {
    const store = memoryAdapter();
    const secrets = createOneTimeSecrets({
      owner: "@test/redraw",
      adapter: () =>
        store.adapter as unknown as ReturnType<
          Parameters<typeof createOneTimeSecrets>[0]["adapter"]
        >,
      secrets: () => ["a-secret-that-is-long-enough-for-the-tests"],
    });
    const mint = () =>
      secrets.mintCode({
        purpose: "sign-in",
        subject: "account-1",
        expiresInMs: 60_000,
        maxWrongTries: 3,
      });

    draws.queue = ["row-1"];
    const first = await mint();
    // The second mint's first id is the live code's, so it derives the same
    // code; its second id does not.
    draws.queue = ["row-1", "row-2"];
    const second = await mint();

    expect(first.ref).toBe("row-1");
    expect(second.ref).toBe("row-2");
    expect(second.code).not.toBe(first.code);
    expect(draws.calls).toBe(3);
  });
});

describe("an attempt that loses its write to a replacing mint", () => {
  it("is neither accepted nor charged against the replacement", async () => {
    const store = memoryAdapter();
    const secrets = createOneTimeSecrets({
      owner: "@test/redraw",
      adapter: () =>
        store.adapter as unknown as ReturnType<
          Parameters<typeof createOneTimeSecrets>[0]["adapter"]
        >,
      secrets: () => ["a-secret-that-is-long-enough-for-the-tests"],
    });
    const mint = () =>
      secrets.mintCode({
        purpose: "sign-in",
        subject: "account-1",
        expiresInMs: 60_000,
        maxWrongTries: 3,
      });

    const earlier = await mint();
    // The replacement is minted after the attempt read the earlier code and
    // before its write, which then loses.
    store.beforeCodeWrite.run = async () => {
      await mint();
    };
    const answer = await secrets.consumeCode({
      purpose: "sign-in",
      subject: "account-1",
      code: earlier.code,
    });

    expect(answer).toEqual({ ok: false, reason: "none" });
    const live = store.rows.find(row => row.liveKey !== null);
    expect(live?.wrongTries).toBe(0);
  });
});
