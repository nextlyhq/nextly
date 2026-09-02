/**
 * That the Background Jobs screen can actually be reached, and by the right
 * people.
 *
 * Three failures are guarded, and each is silent in its own way. A page in the
 * route registry with no navigation entry is routable and undiscoverable. A
 * navigation entry gated on a permission whose RESOURCE is not seeded matches
 * nobody, so the item is invisible to everyone including an administrator, with
 * nothing erroring to say so. And an entry whose href is written out by hand
 * rather than taken from `ROUTES` agrees with the registry until one of them is
 * edited, at which point the link 404s.
 *
 * @module constants/__tests__/background-jobs-nav.test
 */
import { describe, expect, it } from "vitest";

import { buildCapabilities } from "@admin/hooks/useCurrentUserPermissions";
import {
  SETTINGS_NAV,
  isSettingsNavItemVisible,
  type SettingsNavAccess,
} from "@admin/components/layout/sidebar/lib/settings-nav";
import { routeConfig } from "@admin/pages/registry";

import { SYSTEM_RESOURCES_IN_DISPLAY_ORDER } from "../permissions";
import { ROUTES } from "../routes";

const item = SETTINGS_NAV.flatMap(group => group.items).find(
  entry => entry.id === "background-jobs"
);

/** Holds exactly one permission and no capability. */
const only = (permission: string): SettingsNavAccess => ({
  hasPermission: value => value === permission,
  canAccessApiKeys: false,
  canAccessWebhooks: false,
});

describe("the Background Jobs settings entry", () => {
  it("exists in the panel that is actually rendered", () => {
    expect(item).toBeDefined();
  });

  it("takes its destination from ROUTES rather than a literal", () => {
    // Resolved before comparing: optional chaining here would let an ABSENT
    // entry compare `undefined` against a defined route and fail confusingly,
    // or worse, compare two undefineds elsewhere and pass.
    expect(item).toBeDefined();
    if (!item) return;
    expect(item.href).toBe(ROUTES.SETTINGS_BACKGROUND_JOBS);
    expect(ROUTES.SETTINGS_BACKGROUND_JOBS).toBe(
      "/admin/settings/background-jobs"
    );
  });

  it("gates on a permission whose RESOURCE is registered", () => {
    expect(item).toBeDefined();
    if (!item) return;
    expect(item.gate).toEqual({
      kind: "permission",
      permission: "manage-background-jobs",
    });
    // Checked against the one list the permission screens derive from, so a
    // typo cannot agree with itself. An unseeded slug matches nobody.
    expect(SYSTEM_RESOURCES_IN_DISPLAY_ORDER).toContain("background-jobs");
  });

  it("is shown to a holder of that permission", () => {
    expect(item).toBeDefined();
    if (!item) return;
    expect(isSettingsNavItemVisible(item, only("manage-background-jobs"))).toBe(
      true
    );
  });

  it("is hidden from someone holding a different permission", () => {
    // The control. Without it the case above passes against a gate that admits
    // everyone.
    expect(item).toBeDefined();
    if (!item) return;
    expect(isSettingsNavItemVisible(item, only("manage-settings"))).toBe(false);
  });
});

describe("the RAIL above that entry, which the item's own gate cannot see", () => {
  /*
   * Two ways to be invisible, and the assertions above reach only the second.
   * `DualSidebar` shows the Settings rail entry when `canViewSettings` is true;
   * the item's own gate then decides what is inside. An operator holding only
   * `manage-background-jobs` passed the inner gate and was stopped by the outer
   * one, so the destination was reachable only by typing its URL.
   *
   * Driven through `buildCapabilities`, which is what the product calls, rather
   * than through a literal capability object — a hand-built one keeps passing
   * after the real derivation stops setting the flag.
   */
  it("reveals Settings to an operator whose ONLY grant is the jobs permission", () => {
    expect(
      buildCapabilities(["manage-background-jobs"], false).canViewSettings
    ).toBe(true);
  });

  it("still hides it from someone holding an unrelated grant", () => {
    // The control: without it the case above passes against a capability that
    // is true for everyone, which is the other way to be wrong here.
    expect(buildCapabilities(["read-media"], false).canViewSettings).toBe(
      false
    );
  });

  it("reveals Settings for EVERY destination the panel declares", () => {
    /*
     * The general form, and the specific case above is one instance of it.
     * The capability that opens the rail is derived from `SETTINGS_NAV`, so a
     * destination added to the panel reveals it by construction — which is the
     * property that failed when the list was maintained by hand and Background
     * Jobs was added to one side only.
     *
     * User Management is excluded because those destinations answer to their
     * own capabilities, which the rail consults separately.
     */
    const gated = SETTINGS_NAV.filter(group => group.id !== "users")
      .flatMap(group => group.items)
      .filter(item => item.gate.kind === "permission");
    for (const item of gated) {
      const permission =
        item.gate.kind === "permission" ? item.gate.permission : "";
      expect(
        buildCapabilities([permission], false).canViewSettings,
        `${item.id} (${permission})`
      ).toBe(true);
    }
    // The premise: this walked real destinations, not an empty list.
    expect(gated.length).toBeGreaterThan(3);
  });

  it("keeps revealing it for the grants it always revealed for", () => {
    // Adding to this list must not narrow it. One representative grant per
    // group it already covered.
    for (const grant of [
      "manage-settings",
      "read-api-keys",
      "manage-email-providers",
      "manage-email-templates",
    ]) {
      expect(buildCapabilities([grant], false).canViewSettings, grant).toBe(
        true
      );
    }
  });
});

describe("the route behind that entry", () => {
  const route = routeConfig[ROUTES.SETTINGS_BACKGROUND_JOBS];

  it("is registered, so the link leads somewhere", () => {
    expect(route).toBeDefined();
  });

  it("is private and demands the same permission the navigation gates on", () => {
    // Two gates on one screen: the nav decides whether it is offered, the
    // registry decides whether it opens. Disagreeing means either a visible
    // link that refuses, or a hidden page anyone can reach by URL.
    expect(route).toBeDefined();
    if (!route) return;
    expect(route.type).toBe("private");
    expect(route.requiredPermission).toBe("manage-background-jobs");
    expect(item?.gate).toEqual({
      kind: "permission",
      permission: route.requiredPermission,
    });
  });
});
