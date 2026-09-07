import { describe, expect, it, vi } from "vitest";

/**
 * A registration nothing calls is how document locking came to ship as three
 * unused tables: the domain, its schemas and its tests were all complete, and
 * the orchestrator never invoked them, so no consumer could reach any of it.
 *
 * Checked by RUNNING the wiring. Every export of the barrel is replaced with a
 * spy, `registerDomainServices` is called, and each spy must have fired. A
 * source scan for the characters of a call cannot tell a live one from a call
 * inside a dead branch or a mention in a comment, and would fail on
 * reformatting that changes nothing.
 */
const spies = new Map<string, ReturnType<typeof vi.fn>>();

vi.mock("../index", async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(real)) {
    if (typeof value === "function" && name.startsWith("register")) {
      const spy = vi.fn();
      spies.set(name, spy);
      mocked[name] = spy;
    } else {
      mocked[name] = value;
    }
  }
  return mocked;
});

const { registerDomainServices } = await import("../../register");

describe("the DI orchestrator", () => {
  it("has registrations to check, so this cannot pass on an empty list", () => {
    // The control. An absence test over nothing is satisfied by everything,
    // and a mock that failed to intercept would leave this map empty.
    expect(spies.size).toBeGreaterThan(10);
  });

  it("calls every registration the barrel exports", () => {
    registerDomainServices({} as never);

    const uncalled = [...spies]
      .filter(([, spy]) => spy.mock.calls.length === 0)
      .map(([name]) => name);

    expect(uncalled).toEqual([]);
  });
});
