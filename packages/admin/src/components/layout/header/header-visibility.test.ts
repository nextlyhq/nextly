import { describe, expect, it } from "vitest";

import type { PluginMetadata } from "@admin/types/branding";

import { computeHiddenHeaderButtons } from "./header-visibility";

function plugin(
  name: string,
  header: PluginMetadata["header"]
): PluginMetadata {
  return { name, collections: [], header } as PluginMetadata;
}

describe("computeHiddenHeaderButtons", () => {
  it("returns an empty set for undefined / no plugins", () => {
    expect(computeHiddenHeaderButtons(undefined).size).toBe(0);
    expect(computeHiddenHeaderButtons([]).size).toBe(0);
  });

  it("returns an empty set when no plugin hides anything", () => {
    const hidden = computeHiddenHeaderButtons([
      plugin("@acme/a", { slot: "@acme/a/admin#X" }),
    ]);
    expect(hidden.size).toBe(0);
  });

  it("hides the specific buttons a plugin lists", () => {
    const hidden = computeHiddenHeaderButtons([
      plugin("@acme/a", { hide: ["github", "discord"] }),
    ]);
    expect([...hidden].sort()).toEqual(["discord", "github"]);
  });

  it("unions hide lists across plugins", () => {
    const hidden = computeHiddenHeaderButtons([
      plugin("@acme/a", { hide: ["github"] }),
      plugin("@acme/b", { hide: ["notifications"] }),
    ]);
    expect([...hidden].sort()).toEqual(["github", "notifications"]);
  });

  it("hideDefaults: true hides all four built-ins", () => {
    const hidden = computeHiddenHeaderButtons([
      plugin("@acme/a", { hideDefaults: true }),
    ]);
    expect([...hidden].sort()).toEqual([
      "discord",
      "docs",
      "github",
      "notifications",
    ]);
  });
});
