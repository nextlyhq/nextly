import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "../../plugins/plugin-context";

import { orderConfigPlugins } from "./config-loader";

const plugin = (
  name: string,
  extra: Partial<PluginDefinition> = {}
): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: ">=0.0.0",
  ...extra,
});

describe("orderConfigPlugins (CLI resolution — D5/D6/D7)", () => {
  it("returns plugins in dependency (topo) order, not array order", () => {
    const a = plugin("@t/a");
    const b = plugin("@t/b", { dependsOn: { "@t/a": ">=1.0.0" } });

    const ordered = orderConfigPlugins([b, a]); // declared b-first
    expect(ordered.map(p => p.name)).toEqual(["@t/a", "@t/b"]);
  });

  it("fails fast on an incompatible core version", () => {
    const bad = plugin("@t/bad", { nextly: "^99.0.0" });
    try {
      orderConfigPlugins([bad]);
      throw new Error("expected orderConfigPlugins to throw");
    } catch (err) {
      expect(
        (err as { logContext?: { reason?: string } }).logContext?.reason
      ).toBe("core-incompatible");
    }
  });

  it("fails fast on a missing required dependency", () => {
    const needsMissing = plugin("@t/needs", {
      dependsOn: { "@t/absent": ">=1.0.0" },
    });
    try {
      orderConfigPlugins([needsMissing]);
      throw new Error("expected orderConfigPlugins to throw");
    } catch (err) {
      expect(
        (err as { logContext?: { reason?: string } }).logContext?.reason
      ).toBe("missing-dependency");
    }
  });

  it("returns an empty array unchanged", () => {
    expect(orderConfigPlugins([])).toEqual([]);
  });
});
