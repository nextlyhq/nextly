import { describe, expect, it } from "vitest";

import { resolvePluginIcon } from "../resolve-plugin-icon";

describe("resolvePluginIcon", () => {
  it("prefers a shipped asset over a declared lucide name", () => {
    expect(
      resolvePluginIcon(
        { appearance: { icon: "Puzzle", iconAsset: "/x/logo.svg" } },
        { fallback: "Package" }
      )
    ).toEqual({ kind: "asset", src: "/x/logo.svg" });
  });

  it("uses the declared lucide name when no asset is shipped", () => {
    expect(
      resolvePluginIcon(
        { appearance: { icon: "Puzzle" } },
        { fallback: "Package" }
      )
    ).toEqual({ kind: "lucide", name: "Puzzle" });
  });

  it("falls back to the caller's icon when the plugin declares neither", () => {
    expect(
      resolvePluginIcon({ appearance: undefined }, { fallback: "Database" })
    ).toEqual({ kind: "lucide", name: "Database" });
  });

  it("falls back when appearance is absent entirely", () => {
    expect(resolvePluginIcon({}, { fallback: "Package" })).toEqual({
      kind: "lucide",
      name: "Package",
    });
  });

  /**
   * The two sidebar call sites pass `Database` and the two package-shaped call
   * sites pass `Package`. That difference is intended, so this asserts the
   * fallback is honoured rather than that all callers agree: a resolver that
   * hardcoded one default would pass every case above and fail here.
   */
  it("honours a different fallback for a different context", () => {
    const meta = { appearance: {} };
    expect(resolvePluginIcon(meta, { fallback: "Database" })).toEqual({
      kind: "lucide",
      name: "Database",
    });
    expect(resolvePluginIcon(meta, { fallback: "Package" })).toEqual({
      kind: "lucide",
      name: "Package",
    });
  });
});
