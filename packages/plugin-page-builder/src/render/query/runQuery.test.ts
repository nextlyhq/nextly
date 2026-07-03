import { describe, expect, it, vi } from "vitest";

import type { DataProvider } from "../dataProvider";

import { runQuery } from "./runQuery";

const provider = (items: Record<string, unknown>[]): DataProvider => ({
  find: vi.fn().mockResolvedValue({ items }),
  findOne: vi.fn(),
  resolveMedia: vi.fn(),
});

describe("runQuery", () => {
  it("skips when no provider or no collection", async () => {
    expect(
      (await runQuery(undefined, { collection: "posts" }, { n: 5 })).skipped
    ).toBe(true);
    expect((await runQuery(provider([]), {}, { n: 5 })).skipped).toBe(true);
  });

  it("returns items and decrements the budget", async () => {
    const budget = { n: 5 };
    const r = await runQuery(
      provider([{ id: "1" }]),
      { collection: "posts", limit: 3 },
      budget
    );
    expect(r.items).toEqual([{ id: "1" }]);
    expect(budget.n).toBe(4);
  });

  it("skips when the budget is exhausted", async () => {
    const p = provider([{ id: "1" }]);
    const r = await runQuery(p, { collection: "posts" }, { n: 0 });
    expect(r.skipped).toBe(true);
    expect(p.find).not.toHaveBeenCalled();
  });

  it("captures provider errors as an error state", async () => {
    const p: DataProvider = {
      find: vi.fn().mockRejectedValue(new Error("boom")),
      findOne: vi.fn(),
      resolveMedia: vi.fn(),
    };
    const r = await runQuery(p, { collection: "posts" }, { n: 5 });
    expect(r.error).toContain("boom");
    expect(r.items).toEqual([]);
  });
});
