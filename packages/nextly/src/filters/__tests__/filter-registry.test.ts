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

  it("threads value through async filters in order", async () => {
    reg.addFilter<number>("async", async v => v + 1);
    reg.addFilter<number>("async", async v => v * 2);
    expect(await reg.applyFilters("async", 3, {})).toBe(8); // (3+1)*2
  });

  it("removeAction detaches an action so it no longer runs", async () => {
    const calls: string[] = [];
    const fn = async () => {
      calls.push("ran");
    };
    reg.addAction("b", fn);
    reg.removeAction("b", fn);
    await reg.runActions("b", undefined, {});
    expect(calls).toEqual([]);
  });

  it("hasFilters/hasActions reflect presence correctly", async () => {
    const fn = (v: number) => v;
    const act = async () => {};
    expect(reg.hasFilters("z")).toBe(false);
    expect(reg.hasActions("z")).toBe(false);
    reg.addFilter<number>("z", fn);
    reg.addAction("z", act);
    expect(reg.hasFilters("z")).toBe(true);
    expect(reg.hasActions("z")).toBe(true);
    reg.removeFilter<number>("z", fn);
    reg.removeAction("z", act);
    expect(reg.hasFilters("z")).toBe(false);
    expect(reg.hasActions("z")).toBe(false);
  });

  it("clear() wipes both maps so applyFilters returns input unchanged", async () => {
    reg.addFilter<number>("c", v => v + 99);
    const act = async () => {};
    reg.addAction("c", act);
    reg.clear();
    expect(reg.hasFilters("c")).toBe(false);
    expect(reg.hasActions("c")).toBe(false);
    expect(await reg.applyFilters("c", 7, {})).toBe(7);
  });
});

describe("FilterRegistry.applyDecision: every verdict is normalised", () => {
  const ALLOW = { allow: true } as const;

  it.each([
    [{ allow: "false" }],
    [{ allow: "yes" }],
    [{ allow: 1 }],
    ["deny"],
    [{ reason: "no allow key" }],
  ])(
    "denies on the malformed verdict %j instead of passing it through",
    async malformed => {
      // A caller doing `if (verdict.allow)` read `{ allow: "false" }` as allow.
      const reg = new FilterRegistry();
      reg.addFilter("acme.gate", () => malformed as never);
      const verdict = await reg.applyDecision("acme.gate", ALLOW, {});
      expect(verdict).toEqual({ allow: false, reason: "malformed-decision" });
    }
  );

  it("stops the chain at a malformed verdict", async () => {
    const reg = new FilterRegistry();
    let laterRan = false;
    reg.addFilter("acme.gate", () => ({ allow: 1 }) as never);
    reg.addFilter("acme.gate", () => {
      laterRan = true;
      return ALLOW;
    });
    await reg.applyDecision("acme.gate", ALLOW, {});
    expect(laterRan).toBe(false);
  });

  it("keeps the FIRST denial's reason when a later handler throws", async () => {
    // A throw after a specific denial overwrote its reason with "hook-error".
    const reg = new FilterRegistry();
    reg.addFilter("acme.gate", () => ({
      allow: false,
      reason: "domain-blocked",
    }));
    reg.addFilter("acme.gate", () => {
      throw new Error("boom");
    });
    expect(await reg.applyDecision("acme.gate", ALLOW, {})).toEqual({
      allow: false,
      reason: "domain-blocked",
    });
  });

  it("keeps the first denial's reason over a later denial's", async () => {
    const reg = new FilterRegistry();
    reg.addFilter("acme.gate", () => ({ allow: false, reason: "first" }));
    reg.addFilter("acme.gate", () => ({ allow: false, reason: "second" }));
    expect(await reg.applyDecision("acme.gate", ALLOW, {})).toEqual({
      allow: false,
      reason: "first",
    });
  });

  it("returns a fresh object, never the handler's", async () => {
    const returned = { allow: true as const, extra: "kept by the plugin" };
    const reg = new FilterRegistry();
    reg.addFilter("acme.gate", () => returned);
    const verdict = await reg.applyDecision("acme.gate", ALLOW, {});
    expect(verdict).toEqual({ allow: true });
    expect(verdict).not.toBe(returned);
  });

  it("still reads a well-formed verdict as said", async () => {
    // The control: denying everything would pass the cases above.
    const reg = new FilterRegistry();
    reg.addFilter("acme.gate", () => undefined as never);
    reg.addFilter("acme.gate", () => ALLOW);
    expect(await reg.applyDecision("acme.gate", ALLOW, {})).toEqual(ALLOW);
    const denying = new FilterRegistry();
    denying.addFilter("acme.gate", () => ({ allow: false, reason: "nope" }));
    expect(await denying.applyDecision("acme.gate", ALLOW, {})).toEqual({
      allow: false,
      reason: "nope",
    });
  });
});
