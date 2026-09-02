import { describe, expect, it } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import { routeConfig } from "@admin/pages/registry";

import {
  SETTINGS_NAV,
  isSettingsNavItemVisible,
  settingsPanelSlugs,
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

  /**
   * The unchanged case. General Settings answers to `manage-settings`, so this
   * reader lands on the panel's first entry rather than being routed past it.
   */
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
   * The API is what settles this. `requireApiKeyPermission` accepts the
   * action's own grant OR `update-api-keys`, so listing keys answers to
   * read-or-update, and the route now says the same. A reader who could fetch
   * the list over the API is no longer turned away from the page that shows it.
   */
  it("sends an api-key reader to API Keys", () => {
    expect(resolveSettingsLanding(only("read-api-keys"))).toBe(
      ROUTES.SETTINGS_API_KEYS
    );
  });

  /**
   * `create-api-keys` opens the create form, not the list this entry links to,
   * so it is not one of the grants that reaches the panel at all. The landing
   * falls through, and the assertion further down proves no reader the panel
   * admits can reach that fallthrough.
   */
  it("does not offer API Keys to a grant that cannot list them", () => {
    expect(resolveSettingsLanding(only("create-api-keys"))).not.toBe(
      ROUTES.SETTINGS_API_KEYS
    );
  });

  /**
   * The webhooks route is an any-of over the three webhook grants, so reading
   * alone opens it and the panel may offer it.
   */
  it("sends a webhook reader to Webhooks", () => {
    expect(resolveSettingsLanding(only("read-webhooks"))).toBe(
      ROUTES.SETTINGS_WEBHOOKS
    );
  });

  /**
   * User Management sits in the panel but answers to its own grants, which the
   * rail consults separately — so a reader holding only `read-users` still has
   * a destination here.
   */
  it("sends a user reader to Users", () => {
    expect(resolveSettingsLanding(only("read-users"))).toBe(ROUTES.USERS);
  });

  /** The same for roles, which is a separate grant from users. */
  it("sends a role reader to Roles", () => {
    expect(resolveSettingsLanding(only("read-roles"))).toBe(
      ROUTES.SECURITY_ROLES
    );
  });

  /**
   * The fallthrough itself, asked directly. It is unreachable for anyone the
   * panel admits — the assertions below prove that — so this pins the shape of
   * the answer for a reader who holds nothing at all.
   */
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
   * The invariant, derived from the route registry rather than restated.
   *
   * For every grant that reaches the panel, the landing must be a page that
   * grant can actually OPEN.
   *
   * A landing on `/admin/settings` itself does not count as placed.
   * `settingsPanelSlugs()` admits a reader to that URL, but the page behind it
   * is General Settings, whose query answers to `manage-settings` and returns
   * 403 without it — so a reader sent there has been placed on a page that
   * fails. There is therefore no escape hatch for the fallthrough: within this
   * set it must never occur except for `manage-settings`, which is the grant
   * General Settings itself needs.
   */
  it("lands every panel-reaching grant on a page that grant can open", () => {
    const grants = settingsPanelSlugs();
    expect(grants.length).toBeGreaterThan(3);

    for (const grant of grants) {
      const access = only(grant);
      const landing = resolveSettingsLanding(access);

      if (landing === ROUTES.SETTINGS) {
        expect(
          grant,
          `"${grant}" reaches the panel but lands on the panel URL itself, ` +
            "whose page answers to manage-settings and returns 403 without it"
        ).toBe("manage-settings");
        continue;
      }

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
   * The other direction, which the assertion above cannot see.
   *
   * That one checks the DANGEROUS failure: a landing the route would refuse.
   * A stale `routePermission` fails the other way — widen the route to admit
   * `read-api-keys` and this table would still skip the entry, sending a
   * reader who could now open the page somewhere else. The landing is simply
   * absent, so nothing lands anywhere it should not and the check above stays
   * green.
   *
   * Asserting equality with the route's own declaration closes it. Both now
   * read one constant, so this passes by construction rather than by
   * vigilance — and fails the moment someone re-types the value.
   */
  it("declares the same grant the route itself declares", () => {
    const declaring = SETTINGS_NAV.flatMap(group => group.items).filter(
      item => item.routePermission !== undefined
    );

    // The premise: an empty list would make this vacuous.
    expect(declaring.length).toBeGreaterThan(0);

    for (const item of declaring) {
      expect(
        item.routePermission,
        `${item.id} declares a route grant that differs from the route's own ` +
          `requiredPermission; the panel would skip a destination the page admits`
      ).toEqual(routeConfig[item.href]?.requiredPermission);
    }
  });

  /**
   * A control for the invariant above: it must be capable of failing.
   *
   * Two ways it could pass while asserting nothing. If `routeConfig` did not
   * resolve the landings, `required` would be `undefined` throughout and every
   * reader would count as admitted. And if the panel's gate were broader than
   * what its destinations open, some grant would reach the panel with nothing
   * to open, and the assertion above would be measuring an empty set.
   *
   * Both are checked directly rather than assumed: the landings resolve to
   * real guards, and no grant that reaches the panel is left without a
   * destination.
   */
  it("resolves real route guards for the landings it checks", () => {
    const guarded = settingsPanelSlugs()
      .map(grant => resolveSettingsLanding(only(grant)))
      .filter(landing => landing !== ROUTES.SETTINGS)
      .map(landing => routeConfig[landing]?.requiredPermission);

    expect(guarded.length).toBeGreaterThan(2);
    expect(guarded.every(required => required !== undefined)).toBe(true);
  });

  /**
   * The panel's gate and its destinations answer the same question.
   *
   * `settingsPanelSlugs()` is the umbrella that shows the rail entry and opens
   * `/admin/settings`. A grant in it that opens no destination is a rail entry
   * leading to a 403, which is the defect this file exists to prevent.
   */
  it("admits no grant that opens nothing", () => {
    const stranded = settingsPanelSlugs().filter(grant => {
      const access = only(grant);
      return (
        resolveSettingsLanding(access) === ROUTES.SETTINGS &&
        grant !== "manage-settings"
      );
    });

    expect(
      stranded,
      `these grants reach the Settings panel and open nothing in it: ${stranded.join(", ")}`
    ).toEqual([]);
  });
});
