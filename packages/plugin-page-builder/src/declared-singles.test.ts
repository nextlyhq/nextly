/**
 * Which registry rows are Singles the configuration no longer declares: the app's own, and those a
 * plugin contributed. One made in the Schema Builder is never in the configuration.
 */
import { describe, expect, it } from "vitest";

import { declaredByConfig, isOrphanedSingle } from "./declared-singles";
import { builderSinglesIn } from "./site-style-route";

const declared = new Set(["kept"]);

describe("a Single the configuration no longer declares", () => {
  it.each([
    ["code", true],
    ["plugin:@acme/shop", true],
    ["ui", false],
    ["built-in", false],
    [undefined, false],
  ])("whose source is %s is a leftover: %s", (source, leftover) => {
    expect(isOrphanedSingle({ slug: "gone", source }, declared)).toBe(leftover);
    expect(isOrphanedSingle({ slug: "kept", source }, declared)).toBe(false);
    // Nothing is a leftover where the configuration's Singles cannot be read.
    expect(isOrphanedSingle({ slug: "gone", source }, undefined)).toBe(false);
  });

  it("opens nothing in the builder, a plugin's as the app's own", () => {
    const row = (slug: string, source: string) => ({
      slug,
      source,
      fields: [{ name: "content", type: "blocks" }],
    });
    for (const source of ["code", "plugin:@acme/shop"]) {
      expect(builderSinglesIn([row("gone", source)], declared)).toEqual([]);
      // With the configuration's Singles unread, no row it declares is taken as live.
      expect(builderSinglesIn([row("gone", source)], undefined)).toEqual([]);
    }
    expect(
      builderSinglesIn([row("made", "ui")], declared).map(({ slug }) => slug)
    ).toEqual(["made"]);
  });

  it("is judged by a row's source alone", () => {
    expect(declaredByConfig({ source: "plugin:@acme/shop" })).toBe(true);
    expect(declaredByConfig({ source: "pluginless" })).toBe(false);
    expect(declaredByConfig(null)).toBe(false);
  });
});
