/**
 * A plugin with no description is one the admin can only ever show by its
 * package specifier, which is a name chosen for npm rather than for a reader.
 */
import { describe, expect, it } from "vitest";

import type { Logger } from "../shared/types";

import {
  pluginsMissingDescription,
  warnUndescribedPlugins,
} from "./describe-check";
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

describe("warnUndescribedPlugins", () => {
  function fakeLogger() {
    const warnings: string[] = [];
    return {
      logger: { warn: (m: string) => warnings.push(m) } as unknown as Logger,
      warnings,
    };
  }

  it("names every plugin missing one, in one message", () => {
    const { logger, warnings } = fakeLogger();

    warnUndescribedPlugins(
      [plugin("@acme/a"), plugin("@acme/b", "Has one"), plugin("@acme/c")],
      logger
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("@acme/a");
    expect(warnings[0]).toContain("@acme/c");
    // The separating assertion: a message that simply listed every plugin
    // would satisfy the two above.
    expect(warnings[0]).not.toContain("@acme/b");
  });

  /**
   * Silence when there is nothing to say. A warning on every boot of a
   * correctly-described install is noise that trains an operator to ignore the
   * one that matters.
   */
  it("says nothing when every plugin declares one", () => {
    const { logger, warnings } = fakeLogger();

    warnUndescribedPlugins([plugin("@acme/a", "Has one")], logger);

    expect(warnings).toEqual([]);
  });

  it("says nothing when there are no plugins", () => {
    const { logger, warnings } = fakeLogger();

    warnUndescribedPlugins([], logger);

    expect(warnings).toEqual([]);
  });
});
