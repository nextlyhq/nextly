/**
 * Settings has no Image Sizes screen.
 *
 * Image sizes are no longer made or offered, so the screen that defined them,
 * its create and edit pages, and its settings menu entry are gone. An address
 * that once opened one resolves to Not found, as any unknown address does.
 *
 * @module pages/__tests__/image-sizes-removed.test
 */
import { describe, expect, it } from "vitest";

import { visibleSettingsNav } from "@admin/components/layout/sidebar/lib/settings-nav";
import { ROUTES } from "@admin/constants/routes";
import { resolveRoute } from "@admin/lib/routing";

import { routeConfig } from "../registry";

const ADDRESSES = [
  "/admin/settings/image-sizes",
  "/admin/settings/image-sizes/create",
  "/admin/settings/image-sizes/edit/size_1",
];

describe("the removed Image Sizes screen", () => {
  it.each(ADDRESSES)("resolves %s to Not found", address => {
    expect(resolveRoute(address, "").screenName).toBe("Page Not Found");
  });

  it("still resolves the settings screen beside it", () => {
    // The control: the resolver reaches a registered settings page, so the
    // answers above are the routes being absent rather than every address
    // falling through.
    const resolved = resolveRoute(ROUTES.SETTINGS, "");
    expect(resolved.Component).toBe(routeConfig[ROUTES.SETTINGS].component);
  });

  it("has no settings menu entry, whatever the role may do", () => {
    const shown = visibleSettingsNav({
      hasPermission: () => true,
      canAccessApiKeys: true,
      canAccessWebhooks: true,
    }).flatMap(group => group.items);

    expect(shown.map(item => item.id)).not.toContain("image-sizes");
    expect(shown.map(item => item.label)).not.toContain("Image Sizes");
    // The control: the menu is drawn, with the settings beside it.
    expect(shown.map(item => item.id)).toEqual(
      expect.arrayContaining(["general", "user-fields"])
    );
  });
});
