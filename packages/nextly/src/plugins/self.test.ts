import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "./plugin-context";
import { resolvePluginSelf } from "./self";

describe("resolvePluginSelf (identity resolution — D54 shape, P1)", () => {
  it("maps declared owned slugs to themselves", () => {
    const self = resolvePluginSelf({
      name: "@acme/x",
      collections: [{ slug: "forms" }],
      contributes: { singles: [{ slug: "settings" }] },
    } as unknown as PluginDefinition);

    expect(self.name).toBe("@acme/x");
    expect(self.collections.forms).toBe("forms");
    expect(self.singles.settings).toBe("settings");
  });

  it("merges contributes.collections with legacy top-level collections", () => {
    const self = resolvePluginSelf({
      name: "p",
      collections: [{ slug: "a" }],
      contributes: { collections: [{ slug: "b" }] },
    } as unknown as PluginDefinition);

    expect(self.collections).toEqual({ a: "a", b: "b" });
  });

  it("returns empty maps for a plugin that owns no schema", () => {
    const self = resolvePluginSelf({ name: "p" } as PluginDefinition);
    expect(self.collections).toEqual({});
    expect(self.singles).toEqual({});
  });
});
