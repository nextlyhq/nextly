/**
 * What a plugin is called across the admin: its sidebar label, else its
 * package name. An empty label counts as none, as the sidebar treats it, so no
 * surface shows a plugin with no name.
 */
import { describe, expect, it } from "vitest";

import type { PluginMetadata } from "@admin/types/branding";

import { pluginDisplayName } from "./plugin-display-name";

function plugin(label?: string): PluginMetadata {
  return {
    name: "@acme/plugin-reports",
    version: "1.0.0",
    ...(label === undefined ? {} : { appearance: { label } }),
  } as PluginMetadata;
}

describe("pluginDisplayName", () => {
  it("names a plugin by its label", () => {
    expect(pluginDisplayName(plugin("Reports"))).toBe("Reports");
  });

  it("names a plugin with no label, or an empty one, by its package name", () => {
    expect(pluginDisplayName(plugin())).toBe("@acme/plugin-reports");
    expect(pluginDisplayName(plugin(""))).toBe("@acme/plugin-reports");
  });
});
