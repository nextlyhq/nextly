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

describe("resolvePluginIcon on a surface that cannot render images", () => {
  it("keeps the declared lucide name instead of the asset", () => {
    // The case the option exists for: a plugin declaring both is saying "logo
    // where you can, this glyph where you cannot". Resolving the asset and
    // substituting a default afterwards would discard that glyph.
    expect(
      resolvePluginIcon(
        { appearance: { icon: "Puzzle", iconAsset: "/x/logo.svg" } },
        { fallback: "Database", allowAsset: false }
      )
    ).toEqual({ kind: "lucide", name: "Puzzle" });
  });

  it("falls back only when the plugin declared no lucide name", () => {
    expect(
      resolvePluginIcon(
        { appearance: { iconAsset: "/x/logo.svg" } },
        { fallback: "Database", allowAsset: false }
      )
    ).toEqual({ kind: "lucide", name: "Database" });
  });

  // Control: with assets allowed the same input still resolves to the asset,
  // so the option is what changes the answer rather than the input.
  it("still resolves the asset when the surface allows one", () => {
    expect(
      resolvePluginIcon(
        { appearance: { icon: "Puzzle", iconAsset: "/x/logo.svg" } },
        { fallback: "Database" }
      )
    ).toEqual({ kind: "asset", src: "/x/logo.svg" });
  });
});
