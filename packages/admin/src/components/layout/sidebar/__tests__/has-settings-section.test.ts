import { describe, expect, it } from "vitest";

import {
  canAccessApiKeys,
  canAccessWebhooks,
  hasSettingsSection,
} from "../lib/has-settings-section";

const only =
  (...grants: string[]) =>
  (slug: string) =>
    grants.includes(slug);

const NONE = {
  canViewSettings: false,
  canManageEmailProviders: false,
  canManageEmailTemplates: false,
  canViewUsers: false,
  canViewRoles: false,
};

describe("canAccessApiKeys", () => {
  it("admits the grants that open the list", () => {
    expect(canAccessApiKeys(only("read-api-keys"))).toBe(true);
    expect(canAccessApiKeys(only("update-api-keys"))).toBe(true);
  });

  /**
   * These act through the API without listing, and the panel's only api-key
   * entry is the list — so treating them as access showed a link that turned
   * the reader away.
   */
  it("refuses the grants that cannot list", () => {
    expect(canAccessApiKeys(only("create-api-keys"))).toBe(false);
    expect(canAccessApiKeys(only("delete-api-keys"))).toBe(false);
  });
});

describe("canAccessWebhooks", () => {
  it("admits any grant the list route accepts", () => {
    for (const grant of [
      "read-webhooks",
      "update-webhooks",
      "create-webhooks",
    ]) {
      expect(canAccessWebhooks(only(grant)), grant).toBe(true);
    }
  });

  it("refuses a reader holding none of them", () => {
    expect(canAccessWebhooks(only("read-users"))).toBe(false);
  });
});

describe("hasSettingsSection", () => {
  const settled = { isPending: false, hasPermission: only() };

  it("hides the entry from a reader with no way in", () => {
    expect(hasSettingsSection(NONE, settled)).toBe(false);
  });

  /**
   * Shown while the grants resolve, matching the rest of the rail: an entry
   * appearing a moment after the page settles reads as the UI changing its
   * mind, and every destination refuses on its own anyway.
   */
  it("shows it while permissions are still loading", () => {
    expect(hasSettingsSection(NONE, { ...settled, isPending: true })).toBe(
      true
    );
  });

  it.each([
    "canViewSettings",
    "canManageEmailProviders",
    "canManageEmailTemplates",
    "canViewUsers",
    "canViewRoles",
  ] as const)("shows it for a reader holding %s alone", capability => {
    expect(hasSettingsSection({ ...NONE, [capability]: true }, settled)).toBe(
      true
    );
  });

  /**
   * The two that arrive as permissions rather than capabilities. A reader whose
   * only access is the API-keys or webhooks screen still needs the icon, or the
   * destination they can open has no route to it.
   */
  it("shows it for an api-key or webhook grant alone", () => {
    expect(
      hasSettingsSection(NONE, {
        ...settled,
        hasPermission: only("read-api-keys"),
      })
    ).toBe(true);
    expect(
      hasSettingsSection(NONE, {
        ...settled,
        hasPermission: only("read-webhooks"),
      })
    ).toBe(true);
  });

  it("is not revealed by an api-key grant that opens nothing", () => {
    expect(
      hasSettingsSection(NONE, {
        ...settled,
        hasPermission: only("create-api-keys"),
      })
    ).toBe(false);
  });
});
