import { describe, expect, it } from "vitest";

import { Database } from "@admin/components/icons";

import {
  placeStandalonePlugins,
  type StandaloneMenuPlugin,
} from "../lib/place-standalone-plugins";
import type { MainMenuItem } from "../sidebar-types";

const rail = (...ids: string[]): MainMenuItem[] =>
  ids.map(
    id => ({ id, label: id, icon: Database, href: `/${id}` }) as MainMenuItem
  );

const BASE = rail("dashboard", "collections", "media", "plugins", "settings");

const deps = {
  slugOf: (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  iconFor: () => Database,
};

const idsOf = (items: readonly MainMenuItem[]) => items.map(item => item.id);

describe("placeStandalonePlugins", () => {
  it("returns the rail untouched when no plugin is visible", () => {
    const placed = placeStandalonePlugins(BASE, [], deps);
    expect(placed).toBe(BASE);
  });

  it("places a plugin after the entry it names", () => {
    const plugins: StandaloneMenuPlugin[] = [{ name: "Forms", after: "media" }];
    expect(idsOf(placeStandalonePlugins(BASE, plugins, deps))).toEqual([
      "dashboard",
      "collections",
      "media",
      "standalone-forms",
      "plugins",
      "settings",
    ]);
  });

  it("defaults to the plugins entry when none is named", () => {
    const plugins: StandaloneMenuPlugin[] = [{ name: "Forms" }];
    expect(idsOf(placeStandalonePlugins(BASE, plugins, deps))).toEqual([
      "dashboard",
      "collections",
      "media",
      "plugins",
      "standalone-forms",
      "settings",
    ]);
  });

  /**
   * The remap, not a fallthrough. The top-level Users entry is gone and User
   * Management lives under Settings, so a plugin still declaring `after:
   * "users"` sits beside Settings rather than being appended at the end.
   */
  it("anchors a plugin asking for users next to settings", () => {
    const plugins: StandaloneMenuPlugin[] = [{ name: "Audit", after: "users" }];
    expect(idsOf(placeStandalonePlugins(BASE, plugins, deps))).toEqual([
      "dashboard",
      "collections",
      "media",
      "plugins",
      "settings",
      "standalone-audit",
    ]);
  });

  it("orders plugins sharing an anchor by their declared order", () => {
    const plugins: StandaloneMenuPlugin[] = [
      { name: "Second", after: "media", order: 20 },
      { name: "First", after: "media", order: 10 },
    ];
    expect(idsOf(placeStandalonePlugins(BASE, plugins, deps))).toEqual([
      "dashboard",
      "collections",
      "media",
      "standalone-first",
      "standalone-second",
      "plugins",
      "settings",
    ]);
  });

  /**
   * A plugin anchored to an entry this rail does not show — because the reader
   * cannot see it, or because the plugin named something that never existed —
   * is appended rather than dropped. Losing it would make the plugin
   * unreachable over a name it got wrong.
   */
  it("appends a plugin anchored to an entry the rail does not show", () => {
    const plugins: StandaloneMenuPlugin[] = [
      { name: "Orphan", after: "nowhere" },
    ];
    const placed = placeStandalonePlugins(rail("dashboard"), plugins, deps);
    expect(idsOf(placed)).toEqual(["dashboard", "standalone-orphan"]);
  });

  it("prefers a declared label over the plugin name", () => {
    const plugins: StandaloneMenuPlugin[] = [
      { name: "Form Builder", appearance: { label: "Forms" } },
    ];
    const placed = placeStandalonePlugins(BASE, plugins, deps);
    expect(
      placed.find(item => item.id === "standalone-form-builder")?.label
    ).toBe("Forms");
  });
});
