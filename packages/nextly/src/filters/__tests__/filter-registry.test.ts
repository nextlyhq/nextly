// packages/nextly/src/filters/__tests__/filter-registry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  FilterRegistry,
  getFilterRegistry,
  resetFilterRegistry,
} from "../filter-registry";

describe("FilterRegistry", () => {
  let reg: FilterRegistry;
  beforeEach(() => {
    reg = new FilterRegistry();
  });

  it("returns the input unchanged when no filters are registered", async () => {
    expect(await reg.applyFilters("x", 5, {})).toBe(5);
  });

  it("runs filters in registration order, threading the value", async () => {
    reg.addFilter<number>("x", v => v + 1);
    reg.addFilter<number>("x", v => v * 10);
    expect(await reg.applyFilters("x", 1, {})).toBe(20); // (1+1)*10
  });

  it("passes context to each filter", async () => {
    reg.addFilter<string, { suffix: string }>("x", (v, c) => v + c.suffix);
    expect(await reg.applyFilters("x", "a", { suffix: "!" })).toBe("a!");
  });

  it("isolates a throwing filter and keeps the prior value (DEC-1)", async () => {
    reg.setLogger({ error: () => {} });
    reg.addFilter<number>("x", () => {
      throw new Error("boom");
    });
    reg.addFilter<number>("x", v => v + 1);
    expect(await reg.applyFilters("x", 10, {})).toBe(11); // throwing step skipped
  });

  it("removeFilter detaches a filter", async () => {
    const fn = (v: number) => v + 1;
    reg.addFilter<number>("x", fn);
    reg.removeFilter<number>("x", fn);
    expect(await reg.applyFilters("x", 1, {})).toBe(1);
  });

  it("runs actions in order, error-isolated (DEC-2)", async () => {
    reg.setLogger({ error: () => {} });
    const calls: string[] = [];
    reg.addAction<string>("a", () => {
      calls.push("first");
    });
    reg.addAction<string>("a", () => {
      throw new Error("x");
    });
    reg.addAction<string>("a", () => {
      calls.push("third");
    });
    await reg.runActions("a", "p", {});
    expect(calls).toEqual(["first", "third"]);
  });

  it("getFilterRegistry returns a stable globalThis singleton", () => {
    expect(getFilterRegistry()).toBe(getFilterRegistry());
    resetFilterRegistry();
    expect(getFilterRegistry().hasFilters("x")).toBe(false);
  });
});
