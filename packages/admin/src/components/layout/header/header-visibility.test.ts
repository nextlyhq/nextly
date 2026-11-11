import { describe, expect, it } from "vitest";

import type {
  PluginMetadata,
  PluginUserMenuItemMeta,
} from "@admin/types/branding";

import {
  computeHiddenHeaderButtons,
  headerControlsSettled,
  helpGroupShown,
  pluginHeaderItems,
  pluginItemPlace,
  pluginUserMenuItems,
} from "./header-visibility";

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

describe("headerControlsSettled", () => {
  const ANSWERED = { workspace: false, permissions: false };

  it("is unsettled while the workspace answer is pending, bell or not", () => {
    expect(headerControlsSettled({ ...ANSWERED, workspace: true }, true)).toBe(
      false
    );
    expect(headerControlsSettled({ ...ANSWERED, workspace: true }, false)).toBe(
      false
    );
  });

  it("waits on the permissions only where the bell may be offered", () => {
    expect(
      headerControlsSettled({ ...ANSWERED, permissions: true }, true)
    ).toBe(false);
    expect(
      headerControlsSettled({ ...ANSWERED, permissions: true }, false)
    ).toBe(true);
  });

  it("is settled once both answers are in", () => {
    expect(headerControlsSettled(ANSWERED, true)).toBe(true);
  });
});

describe("where a plugin's own item is drawn", () => {
  /** A delivered item; `rest` may be malformed, as a plain config can be. */
  const menuItem = (
    label: string,
    rest: object = { to: "/x" }
  ): PluginUserMenuItemMeta =>
    ({
      id: `${label}.user-menu`,
      label,
      icon: "BookOpen",
      ...rest,
    }) as PluginUserMenuItemMeta;
  const atBar = plugin("@acme/bar", { slot: "@acme/bar/admin#Badge" });
  const legacy = {
    name: "@acme/legacy",
    collections: [],
    headerSlot: "@acme/legacy/admin#Old",
  } as PluginMetadata;
  const atRail = plugin("@acme/rail", {
    slot: "@acme/rail/admin#Helper",
    place: "rail-foot",
  });
  const atMenu = plugin("@acme/menu", {
    place: "menu",
    item: menuItem("Help"),
  });
  const all = [atBar, legacy, atRail, atMenu];

  it("defaults to the bar, for the current spelling and the deprecated one", () => {
    expect(pluginItemPlace(atBar)).toBe("bar");
    expect(pluginItemPlace(legacy)).toBe("bar");
    expect(pluginItemPlace(atRail)).toBe("rail-foot");
    expect(pluginItemPlace(atMenu)).toBe("menu");
  });

  it("hides each item from every place but the one it chose", () => {
    expect(pluginHeaderItems(all).map(item => item.name)).toEqual([
      "@acme/bar",
      "@acme/legacy",
    ]);
    expect(pluginHeaderItems(all, "rail-foot").map(item => item.name)).toEqual([
      "@acme/rail",
    ]);
    expect(pluginUserMenuItems(all).map(item => item.plugin)).toEqual([
      "@acme/menu",
    ]);
  });

  it("hides a menu item with neither a link nor an action, or both", () => {
    const neither = plugin("@acme/neither", {
      place: "menu",
      item: menuItem("Neither", {}),
    });
    const both = plugin("@acme/both", {
      place: "menu",
      item: menuItem("Both", {
        to: "/x",
        action: { open: "@acme/both/admin#X" },
      }),
    });
    const run = plugin("@acme/run", {
      place: "menu",
      item: menuItem("Run", {
        action: { run: { method: "POST", path: "/go" } },
      }),
    });
    expect(
      pluginUserMenuItems([neither, both, run]).map(item => item.label)
    ).toEqual(["Run"]);
  });

  it("orders several items in one place by plugin order, then label", () => {
    const ordered = (name: string, order: number | undefined, label: string) =>
      ({
        name,
        collections: [],
        order,
        header: { place: "menu", item: menuItem(label) },
      }) as PluginMetadata;
    expect(
      pluginUserMenuItems([
        ordered("@acme/c", undefined, "Zeta"),
        ordered("@acme/a", 300, "Alpha"),
        ordered("@acme/b", undefined, "Beta"),
        ordered("@acme/d", 5, "Omega"),
      ]).map(item => item.label)
    ).toEqual(["Omega", "Beta", "Zeta", "Alpha"]);
  });

  it("keeps the configured order for mounted items of equal order", () => {
    const rail = (name: string, order?: number) =>
      ({
        name,
        collections: [],
        order,
        header: { slot: `${name}/admin#X`, place: "rail-foot" },
      }) as PluginMetadata;
    expect(
      pluginHeaderItems(
        [rail("@acme/z"), rail("@acme/a"), rail("@acme/m", 1)],
        "rail-foot"
      ).map(item => item.name)
    ).toEqual(["@acme/m", "@acme/z", "@acme/a"]);
  });

  it("keeps the help group for a plugin's item when the built-in links are hidden", () => {
    const allHidden = computeHiddenHeaderButtons([
      plugin("@acme/quiet", { hideDefaults: true }),
    ]);
    expect(helpGroupShown(allHidden, 0)).toBe(false);
    expect(helpGroupShown(allHidden, 1)).toBe(true);
    expect(helpGroupShown(new Set(["docs", "github"]), 0)).toBe(true);
  });
});
