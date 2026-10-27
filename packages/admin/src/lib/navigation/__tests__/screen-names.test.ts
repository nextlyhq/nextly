/**
 * What each admin screen is called, as the route table declares it.
 *
 * The sidebar's own declarations are replaced below by copies whose labels
 * differ from the shipped ones. A screen the sidebar names must then carry the
 * REPLACED label: a route table that copied "Webhooks" or "Media Library" as a
 * literal would still say the old name, and would pass any test that only
 * compared against today's spelling.
 */
import { CONTENT_SECTION_LABEL } from "@admin/components/layout/sidebar/lib/content-rail";
import { describe, expect, it, vi } from "vitest";

vi.mock("@admin/components/layout/sidebar/lib/settings-nav", async () => {
  const actual = await vi.importActual<
    typeof import("@admin/components/layout/sidebar/lib/settings-nav")
  >("@admin/components/layout/sidebar/lib/settings-nav");
  return {
    ...actual,
    SETTINGS_NAV: actual.SETTINGS_NAV.map(group => ({
      ...group,
      items: group.items.map(item =>
        item.id === "webhooks" ? { ...item, label: "Outgoing Hooks" } : item
      ),
    })),
  };
});

vi.mock("@admin/components/layout/sidebar/sidebar-types", async () => {
  const actual = await vi.importActual<
    typeof import("@admin/components/layout/sidebar/sidebar-types")
  >("@admin/components/layout/sidebar/sidebar-types");
  return {
    ...actual,
    MAIN_MENU_ITEMS: actual.MAIN_MENU_ITEMS.map(item =>
      item.id === "media" ? { ...item, label: "Asset Library" } : item
    ),
  };
});

import { ROUTES } from "@admin/constants/routes";
import {
  clearPluginPages,
  registerPluginPage,
} from "@admin/lib/plugins/plugin-route-registry";
import { resolveRoute } from "@admin/lib/routing";
import { routeConfig } from "@admin/pages/registry";
import type { PluginMetadata } from "@admin/types/branding";

import {
  formatDocumentTitle,
  resolveScreenName,
  type ScreenNameSources,
} from "../screen-names";

const POSTS = {
  name: "posts",
  label: "Post",
  labels: { singular: "Post", plural: "Posts" },
};
const ABOUT = { slug: "about", label: "About Us" };

function nameOf(pattern: string, sources: Partial<ScreenNameSources> = {}) {
  return resolveScreenName(routeConfig[pattern]?.screenName, {
    pathname: pattern,
    ...sources,
  });
}

describe("the name each route gives its screen", () => {
  it("gives every route in the table a name", () => {
    const unnamed = Object.keys(routeConfig).filter(
      pattern => !nameOf(pattern, { collection: POSTS, single: ABOUT })?.trim()
    );

    expect(unnamed).toEqual([]);
  });

  it("names the Content screens as the Content panel names its parts", () => {
    // Both sections sit under one rail item, so their names come from the
    // panel's own labels rather than the rail's.
    expect(nameOf(ROUTES.COLLECTIONS)).toBe(CONTENT_SECTION_LABEL.collections);
    expect(nameOf(ROUTES.SINGLES)).toBe(CONTENT_SECTION_LABEL.singles);
  });

  it("names a settings screen by its entry in the settings panel", () => {
    expect(nameOf(ROUTES.SETTINGS_WEBHOOKS)).toBe("Outgoing Hooks");
    // The screens reached from that entry keep its name; the item they show
    // is what tells them apart.
    expect(nameOf(ROUTES.SETTINGS_WEBHOOKS_DELIVERIES)).toBe("Outgoing Hooks");
  });

  it("names a rail destination by its rail entry", () => {
    expect(nameOf(ROUTES.MEDIA)).toBe("Asset Library");
  });

  it("names a collection's screens by the label the sidebar lists it under", () => {
    expect(nameOf(ROUTES.COLLECTION_ENTRIES, { collection: POSTS })).toBe(
      "Posts"
    );
    expect(
      nameOf(ROUTES.COLLECTION_ENTRY_EDIT, {
        collection: { name: "faq", label: "FAQ", labels: undefined },
      })
    ).toBe("FAQ");
    // Until the collection's answer arrives there is no label to use, and the
    // tab names only the site rather than guessing from the slug.
    expect(nameOf(ROUTES.COLLECTION_ENTRIES)).toBeUndefined();
  });

  it("names a Single's screens by the Single's label", () => {
    expect(nameOf(ROUTES.SINGLE_EDIT, { single: ABOUT })).toBe("About Us");
  });

  it("names a plugin page by its sidebar label, and by its path without one", () => {
    clearPluginPages();
    registerPluginPage({ slug: "acme-forms", path: "inbox", component: "x" });
    registerPluginPage({ slug: "acme-forms", path: "archive", component: "y" });
    const plugins = [
      {
        name: "acme-forms",
        collections: [],
        menu: [
          {
            label: "Forms",
            to: "/admin/plugins/acme-forms",
            children: [
              { label: "Inbox", to: "/admin/plugins/acme-forms/inbox" },
            ],
          },
        ],
      },
    ] as PluginMetadata[];

    const inbox = resolveRoute("/admin/plugins/acme-forms/inbox", "");
    const archive = resolveRoute("/admin/plugins/acme-forms/archive", "");

    expect(
      resolveScreenName(inbox.screenName, {
        pathname: "/admin/plugins/acme-forms/inbox",
        plugins,
      })
    ).toBe("Inbox");
    expect(
      resolveScreenName(archive.screenName, {
        pathname: "/admin/plugins/acme-forms/archive",
        plugins,
      })
    ).toBe("/admin/plugins/acme-forms/archive");
    clearPluginPages();
  });

  it("matches a plugin's menu entry by its path, whatever query, hash or trailing slash it carries", () => {
    clearPluginPages();
    registerPluginPage({ slug: "acme", path: "reports", component: "x" });
    registerPluginPage({ slug: "acme", path: "inbox", component: "y" });
    const plugins = [
      {
        name: "acme",
        collections: [],
        menu: [
          {
            label: "Open Reports",
            to: "/admin/plugins/acme/reports?status=open",
          },
          { label: "Inbox", to: "/admin/plugins/acme/inbox/#unread" },
        ],
      },
    ] as PluginMetadata[];

    const nameAt = (pathname: string) =>
      resolveScreenName(resolveRoute(pathname, "").screenName, {
        pathname,
        plugins,
      });

    expect(nameAt("/admin/plugins/acme/reports")).toBe("Open Reports");
    expect(nameAt("/admin/plugins/acme/inbox")).toBe("Inbox");
    clearPluginPages();
  });

  it("names an address no route answers", () => {
    const route = resolveRoute("/admin/no-such-screen", "");

    expect(
      resolveScreenName(route.screenName, { pathname: "/admin/no-such-screen" })
    ).toBe("Page Not Found");
  });
});

describe("formatDocumentTitle", () => {
  it("reads from the most specific part to the site", () => {
    expect(
      formatDocumentTitle({
        item: "Hello world",
        screen: "Posts",
        site: "Golden Shop",
      })
    ).toBe("Hello world · Posts · Golden Shop");
  });

  it("leaves out a part there is nothing to say for", () => {
    expect(
      formatDocumentTitle({ item: "  ", screen: "Posts", site: "Golden Shop" })
    ).toBe("Posts · Golden Shop");
    expect(formatDocumentTitle({ site: "Golden Shop" })).toBe("Golden Shop");
  });
});
