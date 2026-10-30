/**
 * The cache tag expiry ledger on a database that has not run `nextly migrate`
 * since the table was added: it reports itself unavailable, issuing no
 * statement against the missing table, and warns once rather than on every
 * write and read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { setNextlyLogger } from "../../../observability/logger";
import { createTagExpiryLedger } from "../tag-expiry-ledger";

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
    expect(await ledger.changesSince(0)).toBeUndefined();
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
    await ledger.changesSince(0);
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
