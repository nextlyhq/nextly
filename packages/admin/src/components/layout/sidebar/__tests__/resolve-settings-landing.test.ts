import { describe, expect, it } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import { routeConfig } from "@admin/pages/registry";

import {
  SETTINGS_NAV,
  isSettingsNavItemVisible,
  type SettingsNavAccess,
} from "../lib/settings-nav";
import { resolveSettingsLanding } from "../lib/resolve-settings-landing";

/** A reader holding exactly the listed grants and nothing else. */
function only(...grants: string[]): SettingsNavAccess {
  const held = new Set(grants);
  const hasPermission = (permission: string) => held.has(permission);
  return {
    hasPermission,
    canAccessApiKeys:
      hasPermission("read-api-keys") ||
      hasPermission("create-api-keys") ||
      hasPermission("update-api-keys"),
    canAccessWebhooks:
      hasPermission("read-webhooks") ||
      hasPermission("update-webhooks") ||
      hasPermission("create-webhooks"),
  };
}

describe("resolveSettingsLanding", () => {
  /**
   * The defect this function exists for. Background Jobs was added to the
   * panel table and to none of the hand-written arms, so a jobs-only operator
   * saw the Settings entry, followed it, and landed on General Settings —
   * whose query answers to `manage-settings` and returns 403. Their one
   * reachable destination was never offered.
   */
  it("sends a jobs-only operator to Background Jobs", () => {
    expect(resolveSettingsLanding(only("manage-background-jobs"))).toBe(
      ROUTES.SETTINGS_BACKGROUND_JOBS
    );
  });

  it("still sends a settings manager to General", () => {
    expect(resolveSettingsLanding(only("manage-settings"))).toBe(
      ROUTES.SETTINGS
    );
  });

  /**
   * `update-api-keys` is what the API Keys ROUTE demands, so this reader can
   * open the page the panel offers them.
   */
  it("sends an api-key manager to API Keys", () => {
    expect(resolveSettingsLanding(only("update-api-keys"))).toBe(
      ROUTES.SETTINGS_API_KEYS
    );
  });

  /**
   * The narrower-route case, and the reason `routePermission` exists. The
   * panel SHOWS API Keys to any api-key grant, but its route admits only
   * `update-api-keys`. Landing a read-only holder there would bounce them to
   * the dashboard, so the entry must be skipped rather than chosen.
   */
  it("does not land a read-only api-key holder on a page that refuses them", () => {
    const landing = resolveSettingsLanding(only("read-api-keys"));
    expect(landing).not.toBe(ROUTES.SETTINGS_API_KEYS);
    expect(landing).toBe(ROUTES.SETTINGS);
  });

  it("sends a webhook reader to Webhooks", () => {
    expect(resolveSettingsLanding(only("read-webhooks"))).toBe(
      ROUTES.SETTINGS_WEBHOOKS
    );
  });

  it("sends a user reader to Users", () => {
    expect(resolveSettingsLanding(only("read-users"))).toBe(ROUTES.USERS);
  });

  it("sends a role reader to Roles", () => {
    expect(resolveSettingsLanding(only("read-roles"))).toBe(
      ROUTES.SECURITY_ROLES
    );
  });

  it("falls back to the panel for a reader with no destination", () => {
    expect(resolveSettingsLanding(only())).toBe(ROUTES.SETTINGS);
  });

  /**
   * Panel order is landing order. A reader holding two grants lands on
   * whichever destination the table lists first, so the page they arrive at is
   * the first one in the panel they can see — not an order maintained
   * separately from it.
   */
  it("follows the table's order when several destinations are open", () => {
    expect(
      resolveSettingsLanding(only("manage-background-jobs", "update-api-keys"))
    ).toBe(ROUTES.SETTINGS_API_KEYS);
  });

  /**
   * The anti-drift assertion, derived from the route registry rather than
   * restated beside it. For every destination the panel can choose, whoever
   * the landing admits, the ROUTE must admit too — otherwise the rail sends
   * someone to a guard that turns them away.
   *
   * A destination added to the table whose route is narrower than its gate
   * fails here until it declares `routePermission`, which is the whole reason
   * the field exists.
   */
  it("never chooses a destination whose route would refuse the reader", () => {
    const grants = [
      "manage-settings",
      "manage-background-jobs",
      "manage-email-providers",
      "manage-email-templates",
      "read-users",
      "read-roles",
      "read-api-keys",
      "create-api-keys",
      "update-api-keys",
      "read-webhooks",
      "create-webhooks",
      "update-webhooks",
    ];

    const items = SETTINGS_NAV.flatMap(group => group.items);
    expect(items.length).toBeGreaterThan(5);

    for (const grant of grants) {
      const access = only(grant);
      const landing = resolveSettingsLanding(access);
      if (landing === ROUTES.SETTINGS) continue;

      const required = routeConfig[landing]?.requiredPermission;
      const admitted =
        required === undefined ||
        (Array.isArray(required)
          ? required.some(access.hasPermission)
          : access.hasPermission(required));

      expect(
        admitted,
        `landing ${landing} chosen for "${grant}" is guarded by ${JSON.stringify(required)}`
      ).toBe(true);
    }
  });

  /**
   * A control for the assertion above: it must be capable of failing. The
   * panel does show a destination whose route is narrower than its gate, so
   * consulting visibility ALONE — which is what the check would do if
   * `routePermission` were ignored — picks a refusing route.
   */
  it("would pick a refusing route if visibility alone decided it", () => {
    const access = only("read-api-keys");
    const firstVisible = SETTINGS_NAV.flatMap(group => group.items).find(item =>
      isSettingsNavItemVisible(item, access)
    );

    expect(firstVisible?.href).toBe(ROUTES.SETTINGS_API_KEYS);

    const required = routeConfig[ROUTES.SETTINGS_API_KEYS]?.requiredPermission;
    expect(required).toBe("update-api-keys");
    expect(access.hasPermission(required as string)).toBe(false);
  });
});
