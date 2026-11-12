import {
  Database,
  LayoutDashboard,
  ShieldAlert,
} from "@admin/components/icons";
import { ROUTES } from "@admin/constants/routes";
import { buildCapabilities } from "@admin/hooks/useCurrentUserPermissions";
import type { PluginMetadata } from "@admin/types/branding";
import { describe, expect, it } from "vitest";

import { resolveItemHref } from "../lib/resolve-item-href";
import type { StandaloneLandingReader } from "../lib/standalone-plugin-landing";
import type { MainMenuItem } from "../sidebar-types";

/** A reader with no collections and no permissions. */
const NO_READER: StandaloneLandingReader = {
  collections: [],
  capabilities: buildCapabilities([], false, undefined),
  can: () => false,
};

/** A reader who may read the given plugin collections, and nothing else. */
function reading(slugs: readonly string[]): StandaloneLandingReader {
  return {
    collections: slugs.map(name => ({ name, admin: { isPlugin: true } })),
    capabilities: buildCapabilities([], false, {
      isSuperAdmin: false,
      validUntil: null,
      entities: Object.fromEntries(
        slugs.map(slug => [
          slug,
          {
            kind: "collection" as const,
            read: true,
            create: false,
            update: false,
            delete: false,
            publish: false,
            unpublish: false,
          },
        ])
      ),
    }),
    can: () => false,
  };
}

const makeItem = (overrides: Partial<MainMenuItem>): MainMenuItem => ({
  id: "dashboard",
  label: "Dashboard",
  icon: LayoutDashboard,
  href: ROUTES.DASHBOARD,
  ...overrides,
});

describe("resolveItemHref", () => {
  it("routes the collections icon to the section landing page (Task 7 PR-6c)", () => {
    expect(
      resolveItemHref(
        makeItem({ id: "collections", label: "Collections", href: "#" }),
        [],
        NO_READER
      )
    ).toBe(ROUTES.COLLECTIONS);
  });

  it("routes the singles icon to the section landing page (Task 7 PR-6c)", () => {
    expect(
      resolveItemHref(
        makeItem({ id: "singles", label: "Singles", href: "#" }),
        [],
        NO_READER
      )
    ).toBe(ROUTES.SINGLES);
  });

  it("routes the plugins icon to the section landing page when the user can open it", () => {
    expect(
      resolveItemHref(
        makeItem({ id: "plugins", label: "Plugins", href: "#" }),
        [],
        NO_READER,
        undefined,
        true
      )
    ).toBe(ROUTES.PLUGINS);
  });

  it("keeps the plugins icon a sub-sidebar opener without the settings permissions", () => {
    // The icon is shown to users who can read a plugin-owned collection, which
    // is a wider set than the page's own guard admits. Navigating them would
    // bounce them to the dashboard and remove their only route to that
    // collection, so they keep the sub-sidebar.
    expect(
      resolveItemHref(
        makeItem({ id: "plugins", label: "Plugins", href: "#" }),
        [],
        NO_READER,
        undefined,
        false
      )
    ).toBe("#");
  });

  it("defaults to the sub-sidebar when the caller states no capability", () => {
    expect(
      resolveItemHref(
        makeItem({ id: "plugins", label: "Plugins", href: "#" }),
        [],
        NO_READER
      )
    ).toBe("#");
  });

  it("routes the settings icon to the first reachable subpage when given one", () => {
    const settings = makeItem({
      id: "settings",
      label: "Settings",
      href: ROUTES.SETTINGS,
    });
    // Webhook-only role: General is read-settings-guarded, so land on Webhooks.
    expect(
      resolveItemHref(settings, [], NO_READER, ROUTES.SETTINGS_WEBHOOKS)
    ).toBe(ROUTES.SETTINGS_WEBHOOKS);
    // No override → the item's own href (General).
    expect(resolveItemHref(settings, [], NO_READER)).toBe(ROUTES.SETTINGS);
  });

  it("returns the item's own href for non-categorical items (e.g. builders)", () => {
    expect(
      resolveItemHref(
        makeItem({
          id: "builders",
          label: "Builders",
          href: ROUTES.BUILDER_COLLECTIONS,
          icon: ShieldAlert,
        }),
        [],
        NO_READER
      )
    ).toBe(ROUTES.BUILDER_COLLECTIONS);
  });

  it("routes a standalone plugin icon to the first collection its panel lists", () => {
    const plugins: PluginMetadata[] = [
      {
        name: "Form Builder",
        collections: ["forms", "submissions"],
        appearance: { icon: "Database" },
      },
    ];
    expect(
      resolveItemHref(
        makeItem({
          id: "standalone-form-builder",
          label: "Forms",
          href: "#",
          icon: Database,
        }),
        plugins,
        reading(["forms", "submissions"])
      )
    ).toBe("/admin/collections/forms");
  });

  it("falls back to '#' for a standalone plugin with nothing to open", () => {
    const plugins: PluginMetadata[] = [
      { name: "Empty Plugin", collections: [] },
    ];
    expect(
      resolveItemHref(
        makeItem({
          id: "standalone-empty-plugin",
          label: "Empty",
          href: "#",
          icon: Database,
        }),
        plugins,
        NO_READER
      )
    ).toBe("#");
  });

  it("routes a standalone plugin icon to the landing the plugin names", () => {
    const plugins: PluginMetadata[] = [
      {
        name: "Form Builder",
        collections: ["forms"],
        landing: "/admin/plugins/form-builder/overview",
      },
    ];
    expect(
      resolveItemHref(
        makeItem({
          id: "standalone-form-builder",
          label: "Forms",
          href: "#",
          icon: Database,
        }),
        plugins,
        reading(["forms"])
      )
    ).toBe("/admin/plugins/form-builder/overview");
  });

  it("falls back to '#' when no matching standalone plugin is found", () => {
    expect(
      resolveItemHref(
        makeItem({
          id: "standalone-missing",
          label: "Missing",
          href: "#",
          icon: Database,
        }),
        [],
        NO_READER
      )
    ).toBe("#");
  });

  it("gives the Content item the href it is handed, and none by default", () => {
    const content = makeItem({ id: "content", label: "Content", href: "#" });
    expect(resolveItemHref(content, [], NO_READER)).toBe("#");
    expect(
      resolveItemHref(content, [], NO_READER, undefined, false, ROUTES.SINGLES)
    ).toBe(ROUTES.SINGLES);
  });
});
