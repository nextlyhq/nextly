/**
 * The Settings panel's navigation table.
 *
 * These assert the table itself rather than a render, which is the reason it is
 * a table: order, visibility and grouping are decidable from the data, so they
 * can be checked without standing up the sidebar and its providers.
 */
import { describe, expect, it } from "vitest";

import { ROUTES } from "@admin/constants/routes";

import {
  SETTINGS_NAV,
  isSettingsNavItemVisible,
  visibleSettingsNav,
  type SettingsNavAccess,
} from "../lib/settings-nav";

/** Sees everything, so a hidden entry is the table's doing and not the gate's. */
const superuser: SettingsNavAccess = {
  hasPermission: () => true,
  canAccessApiKeys: true,
  canAccessWebhooks: true,
};

/** Sees nothing. */
const nobody: SettingsNavAccess = {
  hasPermission: () => false,
  canAccessApiKeys: false,
  canAccessWebhooks: false,
};

/** Sees exactly one permission, and no capability. */
const only = (permission: string): SettingsNavAccess => ({
  hasPermission: p => p === permission,
  canAccessApiKeys: false,
  canAccessWebhooks: false,
});

const allItems = SETTINGS_NAV.flatMap(g => g.items);

describe("settings nav table", () => {
  it("configures the system before the people in it", () => {
    expect(visibleSettingsNav(superuser).map(g => g.id)).toEqual([
      "system",
      "email",
      "users",
    ]);
  });

  it("is a non-empty table with unique group and item ids", () => {
    // Population first: every assertion below is about members of this table,
    // and an empty or duplicated table satisfies most of them vacuously.
    expect(SETTINGS_NAV.length).toBeGreaterThan(0);
    expect(allItems.length).toBeGreaterThan(0);

    const groupIds = SETTINGS_NAV.map(g => g.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);

    const itemIds = allItems.map(i => i.id);
    expect(new Set(itemIds).size).toBe(itemIds.length);
  });

  it("routes every destination through the route table", () => {
    // A path composed by hand tracks the page file's location, and the router
    // does not: `pages/dashboard/roles/create.tsx` is served at
    // `/admin/security/roles/create`. Requiring each href to be a declared
    // route makes that divergence impossible to introduce here.
    const declared = new Set<string>(Object.values(ROUTES));
    for (const item of allItems) {
      expect(declared, `${item.id} -> ${item.href}`).toContain(item.href);
    }
  });
});

describe("visibility", () => {
  it("shows nothing to a reader with no permissions, except a plugin slot", () => {
    const groups = visibleSettingsNav(nobody);

    // The users group survives with zero of its OWN items because it carries a
    // plugin slot whose contents this table does not gate.
    expect(groups.map(g => g.id)).toEqual(["users"]);
    expect(groups[0].items).toHaveLength(0);
    expect(groups[0].pluginPlacement).toBe("users");
  });

  it("never presents a group heading with no destinations under it", () => {
    // The property the derived heading exists to guarantee. Previously each
    // group restated its items' permissions in its own heading condition, so a
    // new item under a new permission would appear with no heading above it.
    // Exercised against every permission the table mentions, one at a time.
    const permissions = [
      ...new Set(
        allItems
          .filter(i => i.gate.kind === "permission")
          .map(i => (i.gate as { permission: string }).permission)
      ),
    ];
    expect(permissions.length).toBeGreaterThan(0);

    for (const permission of permissions) {
      for (const group of visibleSettingsNav(only(permission))) {
        if (group.items.length === 0) {
          // Only a plugin-slot group may be empty, and it renders no heading.
          expect(group.pluginPlacement).toBeDefined();
          continue;
        }
        expect(group.items.length).toBeGreaterThan(0);
      }
    }
  });

  it("gates the two capability-backed destinations independently", () => {
    const apiOnly: SettingsNavAccess = {
      hasPermission: () => false,
      canAccessApiKeys: true,
      canAccessWebhooks: false,
    };

    const visible = visibleSettingsNav(apiOnly).flatMap(g =>
      g.items.map(i => i.id)
    );
    expect(visible).toContain("api-keys");
    expect(visible).not.toContain("webhooks");
  });

  it("honours each destination's own gate", () => {
    for (const item of allItems) {
      expect(
        isSettingsNavItemVisible(item, superuser),
        `${item.id} hidden from a reader who may see everything`
      ).toBe(true);
      expect(
        isSettingsNavItemVisible(item, nobody),
        `${item.id} shown to a reader who may see nothing`
      ).toBe(false);
    }
  });

  it("leaves the source table untouched when filtering", () => {
    const before = SETTINGS_NAV.map(g => g.items.length);
    visibleSettingsNav(nobody);
    expect(SETTINGS_NAV.map(g => g.items.length)).toEqual(before);
  });
});
