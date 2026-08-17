import { describe, expect, it } from "vitest";

import type { PluginMetadata } from "@admin/types/branding";

import { resolveVisibleMenuItems } from "./menu";

const allow = () => true;

describe("resolveVisibleMenuItems", () => {
  it("flattens menus from all plugins and sorts by order (default 100)", () => {
    const plugins = [
      {
        name: "@a/p",
        collections: [],
        menu: [{ label: "B", to: "/b", order: 20 }],
      },
      {
        name: "@a/q",
        collections: [],
        menu: [{ label: "A", to: "/a", order: 10 }],
      },
      { name: "@a/r", collections: [], menu: [{ label: "C", to: "/c" }] }, // default 100
    ] satisfies PluginMetadata[];

    const items = resolveVisibleMenuItems(plugins, allow);
    expect(items.map(i => i.label)).toEqual(["A", "B", "C"]);
  });

  it("keeps one level of children, sorted by order", () => {
    const plugins = [
      {
        name: "@a/p",
        collections: [],
        menu: [
          {
            label: "Parent",
            to: "/p",
            children: [
              { label: "Child-2", to: "/p/2", order: 20 },
              { label: "Child-1", to: "/p/1", order: 10 },
            ],
          },
        ],
      },
    ] satisfies PluginMetadata[];

    const items = resolveVisibleMenuItems(plugins, allow);
    expect(items[0].children?.map(c => c.label)).toEqual([
      "Child-1",
      "Child-2",
    ]);
  });

  it("hides items the user lacks permission for, keeps granted ones", () => {
    const plugins = [
      {
        name: "@a/p",
        collections: [],
        menu: [
          { label: "Forms", to: "/f", requiredPermission: "read-forms" },
          { label: "Secret", to: "/s", requiredPermission: "manage-secret" },
          { label: "Open", to: "/o" },
        ],
      },
    ] satisfies PluginMetadata[];

    const can = (p: string) => p === "read-forms";
    const items = resolveVisibleMenuItems(plugins, can);
    expect(items.map(i => i.label)).toEqual(["Forms", "Open"]);
  });

  it("hides a child the user cannot access", () => {
    const plugins = [
      {
        name: "@a/p",
        collections: [],
        menu: [
          {
            label: "Parent",
            to: "/p",
            children: [
              { label: "Allowed", to: "/p/a" },
              { label: "Denied", to: "/p/d", requiredPermission: "x" },
            ],
          },
        ],
      },
    ] satisfies PluginMetadata[];

    const items = resolveVisibleMenuItems(plugins, () => false);
    // Parent has no requiredPermission → visible; only the denied child is removed.
    expect(items[0].children?.map(c => c.label)).toEqual(["Allowed"]);
  });

  it("returns an empty list when no plugins or menus", () => {
    expect(resolveVisibleMenuItems(undefined, allow)).toEqual([]);
    expect(
      resolveVisibleMenuItems(
        [{ name: "@a/p", collections: [] }] satisfies PluginMetadata[],
        allow
      )
    ).toEqual([]);
  });
});

describe("resolveVisibleMenuItems — section attribution", () => {
  const always = () => true;

  const plugins = [
    {
      name: "@acme/reports",
      collections: [],
      placement: "settings",
      menu: [
        { label: "Reports", to: "/r" },
        { label: "Elsewhere", to: "/e", section: "media" as const },
      ],
    },
    {
      name: "@acme/plain",
      collections: [],
      menu: [{ label: "Plain", to: "/p" }],
    },
  ] as unknown as PluginMetadata[];

  it("lists an item under the section its plugin was placed in", () => {
    // The defect this covers: the field was declarable and nothing read it,
    // so every item appeared under Plugins whatever it said.
    expect(
      resolveVisibleMenuItems(plugins, always, "settings").map(i => i.label)
    ).toEqual(["Reports"]);
  });

  it("lets an item OVERRIDE its plugin's placement", () => {
    expect(
      resolveVisibleMenuItems(plugins, always, "media").map(i => i.label)
    ).toEqual(["Elsewhere"]);
  });

  it("keeps an item whose plugin declared nothing under Plugins", () => {
    expect(
      resolveVisibleMenuItems(plugins, always, "plugins").map(i => i.label)
    ).toEqual(["Plain"]);
  });

  it("does not list a placed item under Plugins as well", () => {
    // Appearing in both places is the failure a partition must not have.
    const underPlugins = resolveVisibleMenuItems(plugins, always, "plugins");
    expect(underPlugins.map(i => i.label)).not.toContain("Reports");
    expect(underPlugins.map(i => i.label)).not.toContain("Elsewhere");
  });

  it("returns every item when no section is named", () => {
    // Asserts the population the partition is drawn from, so a filter that
    // dropped everything could not pass the per-section cases vacuously.
    expect(resolveVisibleMenuItems(plugins, always)).toHaveLength(3);
  });
});
