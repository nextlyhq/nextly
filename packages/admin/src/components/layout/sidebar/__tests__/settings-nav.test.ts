/**
 * The Settings panel's navigation table.
 *
 * These assert the table itself rather than a render, which is the reason it is
 * a table: order, visibility and grouping are decidable from the data, so they
 * can be checked without standing up the sidebar and its providers.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EMAIL_HUB_PERMISSIONS } from "@admin/constants/email-hub";
import { ROUTES } from "@admin/constants/routes";
import { useSidebarNavigation } from "@admin/hooks/useSidebarNavigation";

import {
  SETTINGS_NAV,
  isSettingsNavItemActive,
  isSettingsNavItemVisible,
  visibleSettingsNav,
  type SettingsNavAccess,
  type SettingsNavGate,
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

/** Sees exactly these permissions, and no capability. */
const holding = (...permissions: string[]): SettingsNavAccess => ({
  hasPermission: p => permissions.includes(p),
  canAccessApiKeys: false,
  canAccessWebhooks: false,
});

const allItems = SETTINGS_NAV.flatMap(g => g.items);

/** Every permission a gate names, one at a time satisfying it. */
const gatePermissions = (gate: SettingsNavGate): readonly string[] =>
  gate.kind === "permission"
    ? [gate.permission]
    : gate.kind === "anyOf"
      ? gate.permissions
      : [];

/** Each visible group as its label and the labels of its destinations. */
const shape = (access: SettingsNavAccess) =>
  visibleSettingsNav(access).map(g => [g.label, g.items.map(i => i.label)]);

describe("settings nav table", () => {
  it("orders the groups Site, People, Developers", () => {
    expect(visibleSettingsNav(superuser).map(g => g.label)).toEqual([
      "Site",
      "People",
      "Developers",
    ]);
  });

  it("files each destination under its group, in order", () => {
    expect(shape(superuser)).toEqual([
      ["Site", ["General", "Email"]],
      ["People", ["Users", "Roles"]],
      ["Developers", ["API Keys", "Webhooks", "Background Jobs"]],
    ]);
  });

  it("has no user fields entry: that screen is reached from the Users page", () => {
    expect(allItems.map(i => i.id)).not.toContain("user-fields");
    expect(allItems.map(i => i.href)).not.toContain(ROUTES.USERS_FIELDS);
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

    // The People group survives with zero of its OWN items because it carries
    // the slot for plugins placed beside users, whose contents this table does
    // not gate. It draws no heading without destinations of its own.
    expect(groups.map(g => g.id)).toEqual(["people"]);
    expect(groups[0].items).toHaveLength(0);
    expect(groups[0].pluginPlacement).toBe("users");
  });

  it.each([
    ["read-email-templates", [["Site", ["Email"]]]],
    ["read-email-providers", [["Site", ["Email"]]]],
    ["read-settings", [["Site", ["General"]]]],
    ["read-users", [["People", ["Users"]]]],
    ["read-roles", [["People", ["Roles"]]]],
    ["manage-background-jobs", [["Developers", ["Background Jobs"]]]],
  ])(
    "shows a reader holding only %s the groups they can open something in",
    (permission, expected) => {
      // The People group's plugin slot is left aside here: it is kept for its
      // plugin contents, and shows no heading or destination of its own.
      const withDestinations = shape(holding(permission)).filter(
        ([, items]) => items.length > 0
      );
      expect(withDestinations).toEqual(expected);
    }
  );

  it("shows Email for any grant that shows one of its tabs, and not without one", () => {
    expect(EMAIL_HUB_PERMISSIONS.length).toBeGreaterThan(0);
    for (const permission of EMAIL_HUB_PERMISSIONS) {
      const ids = visibleSettingsNav(holding(permission)).flatMap(g =>
        g.items.map(i => i.id)
      );
      expect(ids, permission).toContain("email");
    }
    // A grant that changes templates without reading them shows no tab.
    const ids = visibleSettingsNav(holding("create-email-templates")).flatMap(
      g => g.items.map(i => i.id)
    );
    expect(ids).not.toContain("email");
  });

  it("drops the Developers group for a reader who can open none of it", () => {
    const groups = visibleSettingsNav(holding("read-settings", "read-users"));
    expect(groups.map(g => g.id)).toEqual(["site", "people"]);
  });

  it("never presents a group heading with no destinations under it", () => {
    // The property the derived heading exists to guarantee. Previously each
    // group restated its items' permissions in its own heading condition, so a
    // new item under a new permission would appear with no heading above it.
    // Exercised against every permission the table mentions, one at a time.
    const permissions = [
      ...new Set(allItems.flatMap(i => gatePermissions(i.gate))),
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

describe("which destination is highlighted", () => {
  /** The panel's own highlight rule, asked with the sidebar's real matcher. */
  function activeAt(pathname: string): string[] {
    const { result } = renderHook(() => useSidebarNavigation([], pathname));
    return allItems
      .filter(item => isSettingsNavItemActive(item, result.current.isActive))
      .map(item => item.id);
  }

  /*
   * The user fields screens have no entry of their own and are reached from
   * the Users page, so Users is where the reader is, as the trail says.
   */
  it("highlights Users on the user fields screens", () => {
    expect(activeAt(ROUTES.USERS_FIELDS)).toEqual(["users"]);
    expect(activeAt(ROUTES.USERS_FIELDS_CREATE)).toEqual(["users"]);
  });

  it("highlights Users on its own list, and nothing else", () => {
    expect(activeAt(ROUTES.USERS)).toEqual(["users"]);
  });

  /*
   * General's address is a prefix of every Settings address, Email's
   * included, so it matches exactly; Email's own pages keep Email highlighted.
   */
  it("highlights Email on its tabs and editors, and not General", () => {
    expect(activeAt(ROUTES.EMAIL)).toEqual(["email"]);
    expect(activeAt(ROUTES.EMAIL_SENDING_CREATE)).toEqual(["email"]);
    expect(activeAt(ROUTES.SETTINGS)).toEqual(["general"]);
  });
});
