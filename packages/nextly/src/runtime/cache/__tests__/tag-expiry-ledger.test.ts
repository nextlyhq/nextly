/**
 * The cache tag expiry ledger on a database that has not run `nextly migrate`
 * since the table was added: it reports itself unavailable, issuing no
 * statement against the missing table, and warns once rather than on every
 * write and read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { setNextlyLogger } from "../../../observability/logger";
import { createTagExpiryLedger, ledgerFor } from "../tag-expiry-ledger";

afterEach(() => {
  setNextlyLogger(undefined);
});

/** An adapter whose catalogue says the table does not exist yet. */
function withoutTheTable() {
  const getDrizzle = vi.fn(() => {
    throw new Error("a statement reached the missing table");
  });
  const adapter = {
    getCapabilities: () => ({ dialect: "sqlite" }),
    tableExists: vi.fn(async () => false),
    getDrizzle,
  };
  return { adapter: adapter as never, getDrizzle };
}

describe("the cache tag expiry ledger without its table", () => {
  it("records nothing, reads nothing and prunes nothing, without a statement", async () => {
    const { adapter, getDrizzle } = withoutTheTable();
    const ledger = createTagExpiryLedger(adapter);

    expect(await ledger.record(["posts"])).toBe(false);
    expect(await ledger.expiriesOf(["posts"])).toBeUndefined();
    expect(await ledger.prune(1000)).toBe(0);
    expect(getDrizzle).not.toHaveBeenCalled();
  });

  it("warns once that the table is missing, naming the command that adds it", async () => {
    const warnings: Record<string, unknown>[] = [];
    const ignore = () => undefined;
    setNextlyLogger({
      warn: (payload: object) =>
        warnings.push(payload as Record<string, unknown>),
      error: ignore,
      info: ignore,
      debug: ignore,
    });
    const ledger = createTagExpiryLedger(withoutTheTable().adapter);

    await ledger.record(["posts"]);
    await ledger.expiriesOf(["posts"]);
    await ledger.record(["pages"]);

    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings[0])).toContain("nextly migrate");
  });

  it("records nothing for no tags, without asking the catalogue", async () => {
    const { adapter } = withoutTheTable();
    const ledger = createTagExpiryLedger(adapter);
    expect(await ledger.record([])).toBe(true);
    expect(
      (adapter as unknown as { tableExists: ReturnType<typeof vi.fn> })
        .tableExists
    ).not.toHaveBeenCalled();
  });
});

describe("one ledger per adapter", () => {
  it("is the same ledger for every caller, so its missing-table warning stays once-only", async () => {
    const warnings: unknown[] = [];
    const ignore = () => undefined;
    setNextlyLogger({
      warn: (payload: object) => warnings.push(payload),
      error: ignore,
      info: ignore,
      debug: ignore,
    });
    const { adapter } = withoutTheTable();

    // Two retention passes and a drain, each asking for the adapter's ledger.
    expect(ledgerFor(adapter)).toBe(ledgerFor(adapter));
    await ledgerFor(adapter).prune(1000);
    await ledgerFor(adapter).prune(1000);
    await ledgerFor(adapter).prune(1000);

    expect(warnings).toHaveLength(1);
  });
});

/** An adapter whose table holds `batches` of rows, as the prune finds them. */
function withRowsToPrune(batches: number) {
  let left = batches;
  const deletes = vi.fn(async () => ({ changes: 1000 }));
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              if (left === 0) return [];
              left -= 1;
              return Array.from({ length: 1000 }, (_, i) => ({
                id: `${left}-${i}`,
              }));
            },
          }),
        }),
      }),
    }),
    delete: () => ({ where: deletes }),
  };
  const adapter = {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    tableExists: async () => true,
    getDrizzle: () => db,
  };
  return { adapter: adapter as never, deletes };
}

describe("a prune with a deadline", () => {
  it("stops between batches once the clock reaches it", async () => {
    const { adapter, deletes } = withRowsToPrune(5);
    let now = 0;
    const ledger = createTagExpiryLedger(adapter);

    // Each batch takes 10 ms of the caller's clock; the budget is 15 ms.
    const removed = await ledger.prune(1000, {
      deadline: 15,
      clock: () => {
        const at = now;
        now += 10;
        return at;
      },
    });

    expect(deletes).toHaveBeenCalledTimes(2);
    expect(removed).toBe(2000);
  });

  it("prunes every batch, up to its cap, with no deadline", async () => {
    const { adapter, deletes } = withRowsToPrune(5);
    expect(
      await createTagExpiryLedger(adapter).prune(1000, { maxBatches: 3 })
    ).toBe(3000);
    expect(deletes).toHaveBeenCalledTimes(3);
  });
});
