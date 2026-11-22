/**
 * Where the Page Builder sits in the admin: its own rail item after Forms,
 * the overview that item opens, and the panel beside it.
 *
 * The page builder is a daily editing tool, like Forms, so it takes a rail
 * item of its own (`placement: "standalone"`) rather than a heading in the
 * Plugins panel; a standalone plugin's menu items are listed in its own panel,
 * so they leave the Plugins panel with it. Its collections stay out of the
 * Collections listing (they are hidden) and out of the panel's collection list
 * (they are not `isPlugin`), so the panel lists exactly the items declared
 * here.
 *
 * @module overview/admin-panel
 */
import type {
  PluginAdminPage,
  PluginAdminPanel,
  PluginDefinition,
  PluginMenuItem,
} from "@nextlyhq/plugin-sdk";

import { BINDINGS_TO_FIX_PAGE_HREF } from "../bindings-report/contract";
import {
  BINDINGS_TO_FIX_ATTENTION_ID,
  EDIT_PAGES_PERMISSION,
} from "../bindings-report/widget";
import {
  BINDINGS_TO_FIX_PAGE_COMPONENT,
  FONTS_PAGE_COMPONENT,
  OVERVIEW_PAGE_COMPONENT,
} from "../builder-view";
import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PATTERNS_SLUG } from "../collections/patterns";
import { TEMPLATES_SLUG } from "../collections/templates";
import { SITE_STYLE_SLUG } from "../site-style-storage";

import { OVERVIEW_PAGE_HREF, OVERVIEW_ROUTE_PATH } from "./contract";

/**
 * The rail anchor the form builder places Forms after, and the order it takes
 * there. The rail sorts plugins sharing an anchor by `order`, lower first, so
 * a higher order than Forms' puts the Page Builder right after it; on a site
 * without Forms it sits right after Media.
 */
const FORMS_ANCHOR = "media";
const AFTER_FORMS_ORDER = 60;

/** The group ids the panel lists its items under. */
const LIBRARY_GROUP = "library";
const CHECKS_GROUP = "checks";
const DESIGN_GROUP = "design";

/**
 * Who may open the Fonts page: whoever may change the site's design, the
 * permission every font route and the builder's Fonts screen ask, so the
 * people who may change the site's fonts in the builder may change them here.
 */
const CHANGE_DESIGN_PERMISSION = `update-${SITE_STYLE_SLUG}`;

/** The Fonts page's address segment, after the plugin's own. */
const FONTS_PAGE_PATH = "/fonts";

/** The Fonts page's address from the admin's root, which its item opens. */
const FONTS_PAGE_HREF = `/admin/plugins/nextlyhq-plugin-page-builder${FONTS_PAGE_PATH}`;

/**
 * The plugin's placement in the admin: standalone, after Forms, opening the
 * overview. Spread into the plugin's `admin` beside its appearance.
 */
export const PAGE_BUILDER_PLACEMENT: Pick<
  NonNullable<PluginDefinition["admin"]>,
  "placement" | "after" | "order" | "landing"
> = {
  placement: "standalone",
  after: FORMS_ANCHOR,
  order: AFTER_FORMS_ORDER,
  landing: OVERVIEW_PAGE_HREF,
};

/**
 * The plugin's own admin pages: the overview, the "Bindings to fix" page and
 * the Fonts page,
 * at `/admin/plugins/nextlyhq-plugin-page-builder/<path>`. The overview is for
 * those who edit pages, as the bindings page, its route and its dashboard card
 * are; anyone else opening the rail item lands on the first library the panel
 * lists for them.
 */
export const PAGE_BUILDER_PAGES: PluginAdminPage[] = [
  {
    path: OVERVIEW_ROUTE_PATH,
    component: OVERVIEW_PAGE_COMPONENT,
    requiredPermission: EDIT_PAGES_PERMISSION,
  },
  {
    path: "/bindings-to-fix",
    component: BINDINGS_TO_FIX_PAGE_COMPONENT,
    requiredPermission: EDIT_PAGES_PERMISSION,
  },
  {
    path: FONTS_PAGE_PATH,
    component: FONTS_PAGE_COMPONENT,
    requiredPermission: CHANGE_DESIGN_PERMISSION,
  },
];

/** The headings the panel lists its items under, in order. */
export const PAGE_BUILDER_PANEL: PluginAdminPanel = {
  groups: [
    { id: LIBRARY_GROUP, label: "Library" },
    { id: CHECKS_GROUP, label: "Checks" },
    { id: DESIGN_GROUP, label: "Design" },
  ],
};

/**
 * One library's item: its collection, named rather than spelled so a host's
 * rename moves the link, the gate and the count with it, and a quiet count of
 * the same collection the item opens.
 */
function libraryItem(
  label: string,
  collection: string,
  icon: string
): PluginMenuItem {
  return {
    label,
    collection,
    to: `/admin/collections/${collection}`,
    icon,
    group: LIBRARY_GROUP,
    count: { collection },
  };
}

/**
 * The panel's items: the four libraries, then the site-wide report of
 * bindings that no longer fit, then the site's fonts.
 *
 * Components names the plugin's own collection whether or not a host keeps
 * its component definitions in a store of its own: the item opens that
 * collection, so its count is that collection's too.
 *
 * Each library's item is gated on reading its collection, through its
 * `collection`; "Bindings to fix" asks what its page asks. Its badge is the
 * report's Needs your attention line, so the panel, the dashboard and the
 * page give one number, and none at all while nothing needs fixing.
 */
export const PAGE_BUILDER_MENU: PluginMenuItem[] = [
  libraryItem("Saved sections", PATTERNS_SLUG, "LayoutTemplate"),
  libraryItem("Components", COMPONENTS_SLUG, "Component"),
  // A frame beside the content: the framed page with a header row is the
  // admin's icon for a Single.
  libraryItem("Header & footer", LAYOUTS_SLUG, "PanelRight"),
  // The designs collections' entries are drawn with, and where each
  // collection's entries are served.
  libraryItem("Collection templates", TEMPLATES_SLUG, "LayoutDashboard"),
  {
    label: "Bindings to fix",
    to: BINDINGS_TO_FIX_PAGE_HREF,
    // Neutral: the entry is there whether or not anything needs fixing; the
    // badge says how many when something does.
    icon: "Unlink",
    requiredPermission: EDIT_PAGES_PERMISSION,
    group: CHECKS_GROUP,
    badge: { attention: BINDINGS_TO_FIX_ATTENTION_ID },
  },
  {
    label: "Fonts",
    to: FONTS_PAGE_HREF,
    icon: "Type",
    // Asks what its page asks, so it is listed only for those it opens for.
    requiredPermission: CHANGE_DESIGN_PERMISSION,
    group: DESIGN_GROUP,
  },
];
