import { describe, expect, it } from "vitest";

import { collectPluginContributedSlugs } from "../recording-provenance";

describe("collectPluginContributedSlugs", () => {
  it("reads slugs from contributes.<kind>", () => {
    const plugins = [
      {
        name: "forms",
        contributes: { collections: [{ slug: "submissions" }] },
      },
      { name: "settings", contributes: { singles: [{ slug: "site-config" }] } },
    ];
    expect([...collectPluginContributedSlugs(plugins, "collections")]).toEqual([
      "submissions",
    ]);
    expect([...collectPluginContributedSlugs(plugins, "singles")]).toEqual([
      "site-config",
    ]);
  });

  it("reads the legacy plugin.<kind> shape too", () => {
    const plugins = [{ name: "legacy", collections: [{ slug: "leads" }] }];
    expect(
      collectPluginContributedSlugs(plugins, "collections").has("leads")
    ).toBe(true);
  });

  it("does NOT depend on admin.isPlugin — a plugin that omits the flag is still detected", () => {
    // The whole point: provenance comes from the contribution list, not the
    // optional presentation flag, so a third-party plugin's opt-out is tagged
    // `plugin` and survives a code-first reconcile.
    const plugins = [
      {
        name: "third-party",
        contributes: { collections: [{ slug: "audit-log" }] },
      },
    ];
    expect(
      collectPluginContributedSlugs(plugins, "collections").has("audit-log")
    ).toBe(true);
  });

  it("ignores entries without a slug and tolerates missing plugins", () => {
    const plugins = [
      { name: "x", contributes: { collections: [{}, { slug: "" }] } },
    ];
    expect(collectPluginContributedSlugs(plugins, "collections").size).toBe(0);
    expect(collectPluginContributedSlugs(undefined, "collections").size).toBe(
      0
    );
  });
});
