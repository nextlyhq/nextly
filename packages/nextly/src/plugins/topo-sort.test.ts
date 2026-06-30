import { describe, it, expect } from "vitest";
import type { PluginDefinition } from "./plugin-context";
import { topoSortPlugins } from "./topo-sort";

const p = (name: string, deps?: string[]): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: "*",
  ...(deps ? { dependsOn: Object.fromEntries(deps.map(d => [d, "*"])) } : {}),
});

/** Capture the NextlyError a thunk throws so we can assert on its structured fields. */
function thrownError(fn: () => unknown): {
  logMessage?: string;
  logContext?: { reason?: string };
} {
  try {
    fn();
  } catch (e) {
    return e as { logMessage?: string; logContext?: { reason?: string } };
  }
  throw new Error("expected the function to throw, but it did not");
}

describe("topoSortPlugins", () => {
  it("preserves array order when there are no deps (tiebreaker)", () => {
    const out = topoSortPlugins([p("a"), p("b"), p("c")]);
    expect(out.map(x => x.name)).toEqual(["a", "b", "c"]);
  });

  it("orders dependencies before dependents", () => {
    const out = topoSortPlugins([p("a", ["b"]), p("b")]);
    expect(out.map(x => x.name)).toEqual(["b", "a"]);
  });

  it("uses original array order as a stable tiebreaker among independents", () => {
    const out = topoSortPlugins([p("a", ["c"]), p("b"), p("c")]);
    expect(out.map(x => x.name)).toEqual(["b", "c", "a"]);
  });

  it("includes present optional dependencies as edges", () => {
    const a: PluginDefinition = { ...p("a"), optionalDependsOn: { b: "*" } };
    const out = topoSortPlugins([a, p("b")]);
    expect(out.map(x => x.name)).toEqual(["b", "a"]);
  });

  it("ignores absent optional dependencies", () => {
    const a: PluginDefinition = {
      ...p("a"),
      optionalDependsOn: { missing: "*" },
    };
    const out = topoSortPlugins([a]);
    expect(out.map(x => x.name)).toEqual(["a"]);
  });

  it("throws on a missing required dependency", () => {
    const err = thrownError(() => topoSortPlugins([p("a", ["missing"])]));
    expect(err.logContext?.reason).toBe("missing-dependency");
    expect(err.logMessage).toMatch(/not registered/i);
  });

  it("throws on a dependency cycle", () => {
    const err = thrownError(() =>
      topoSortPlugins([p("a", ["b"]), p("b", ["a"])])
    );
    expect(err.logContext?.reason).toBe("dependency-cycle");
    expect(err.logMessage).toMatch(/cycle/i);
  });
});
