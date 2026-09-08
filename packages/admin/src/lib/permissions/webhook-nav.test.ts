/**
 * Webhook nav items are gated by system permissions, not collection
 * capabilities, so filterNavigationItems must resolve `read-webhooks` /
 * `update-webhooks` through `canViewWebhooks` rather than the collection map
 * (where webhooks, a system resource, does not appear).
 */
import { describe, expect, it } from "vitest";

import type { NavigationItem } from "@admin/constants/navigation";
import { buildCapabilities } from "@admin/hooks/useCurrentUserPermissions";
import type { AdminCapabilities } from "@admin/types/permissions";

import { filterNavigationItems } from "./authorization";

// Derived the way the product derives it, never hand-built. A literal here has
// to be edited every time a capability is added, and — worse — it goes on
// passing after `buildCapabilities` stops setting a flag the literal still sets
// for itself, which is a test asserting against a shape nothing produces.
const base: AdminCapabilities = buildCapabilities([], false);

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
