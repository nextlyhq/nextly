/**
 * A plugin with no description is one the admin can only ever show by its
 * package specifier, which is a name chosen for npm rather than for a reader.
 */
import { describe, expect, it } from "vitest";

import { pluginsMissingDescription } from "./describe-check";
import type { PluginDefinition } from "./plugin-context";

function plugin(name: string, description?: string): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    ...(description === undefined ? {} : { admin: { description } }),
  } as PluginDefinition;
}

describe("pluginsMissingDescription", () => {
  it("names a plugin that declares none", () => {
    expect(pluginsMissingDescription([plugin("@acme/bare")])).toEqual([
      "@acme/bare",
    ]);
  });

  it("passes a plugin that declares one", () => {
    expect(
      pluginsMissingDescription([plugin("@acme/described", "Does a thing")])
    ).toEqual([]);
  });

  /**
   * The separating cases. A present-but-useless value satisfies `!== undefined`
   * and an optional-chain check alike, so a test that only covers "absent"
   * passes on an implementation that admits an empty string.
   */
  it.each([
    ["empty", ""],
    ["whitespace", "   "],
  ])("names a plugin whose description is %s", (_why, value) => {
    expect(pluginsMissingDescription([plugin("@acme/blank", value)])).toEqual([
      "@acme/blank",
    ]);
  });

  it("reports only the ones missing it, in order", () => {
    const result = pluginsMissingDescription([
      plugin("@acme/a"),
      plugin("@acme/b", "Has one"),
      plugin("@acme/c"),
    ]);

    expect(result).toEqual(["@acme/a", "@acme/c"]);
  });

  it("says nothing about an empty plugin list", () => {
    expect(pluginsMissingDescription([])).toEqual([]);
  });
});
