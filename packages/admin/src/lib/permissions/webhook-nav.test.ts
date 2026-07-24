/**
 * Webhook nav items are gated by system permissions, not collection
 * capabilities, so filterNavigationItems must resolve `read-webhooks` /
 * `update-webhooks` through `canViewWebhooks` rather than the collection map
 * (where webhooks, a system resource, does not appear).
 */
import { describe, expect, it } from "vitest";

import type { NavigationItem } from "@admin/constants/navigation";
import type { AdminCapabilities } from "@admin/types/permissions";

import { filterNavigationItems } from "./authorization";

const base: AdminCapabilities = {
  isSuperAdmin: false,
  canViewCollections: false,
  canViewUsers: false,
  canViewRoles: false,
  canViewMedia: false,
  canViewSettings: false,
  canViewWebhooks: false,
  collections: {},
  canManageUsers: false,
  canManageRoles: false,
  canManageMedia: false,
  canManageSettings: false,
  canManageEmailProviders: false,
  canManageEmailTemplates: false,
};

const webhookItem: NavigationItem = {
  title: "Webhooks",
  href: "/admin/settings/webhooks",
  icon: (() => null) as unknown as NavigationItem["icon"],
  category: "settings",
  requiredPermission: ["read-webhooks", "update-webhooks"],
};

const isVisible = (caps: AdminCapabilities) =>
  filterNavigationItems([webhookItem], caps).length === 1;

describe("webhook navigation visibility", () => {
  it("shows the item to a user with webhook access", () => {
    expect(isVisible({ ...base, canViewWebhooks: true })).toBe(true);
  });

  it("hides the item from a user without webhook access", () => {
    expect(isVisible(base)).toBe(false);
  });

  it("shows the item to a super-admin", () => {
    expect(isVisible({ ...base, isSuperAdmin: true })).toBe(true);
  });
});
