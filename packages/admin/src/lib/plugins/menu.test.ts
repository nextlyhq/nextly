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
