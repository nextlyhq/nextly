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

  it("resolves a renamed slug through the plugin renameMap", () => {
    // The schema fold rewrites the contributed entry to the renamed slug, so
    // the effective slug (not the declared one) must be reported — otherwise a
    // renamed plugin's opt-out is mistagged `code` and pruned, and a disabled
    // plugin's renamed single slips the hook-skip filter.
    const plugins = [
      {
        name: "settings",
        contributes: { singles: [{ slug: "settings" }] },
        renameMap: { settings: "site-settings" },
      },
    ];
    const singles = collectPluginContributedSlugs(plugins, "singles");
    expect(singles.has("site-settings")).toBe(true);
    expect(singles.has("settings")).toBe(false);
  });

  it("applies the renameMap to the legacy plugin.<kind> shape too", () => {
    const plugins = [
      {
        name: "legacy",
        collections: [{ slug: "leads" }],
        renameMap: { leads: "contacts" },
      },
    ];
    const collections = collectPluginContributedSlugs(plugins, "collections");
    expect(collections.has("contacts")).toBe(true);
    expect(collections.has("leads")).toBe(false);
  });

  it("leaves a slug the renameMap does not mention untouched", () => {
    const plugins = [
      {
        name: "forms",
        contributes: { collections: [{ slug: "submissions" }] },
        renameMap: { other: "renamed" },
      },
    ];
    expect(
      collectPluginContributedSlugs(plugins, "collections").has("submissions")
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
