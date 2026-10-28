import {
  Feather,
  LayoutDashboard,
  Languages,
  Image as ImageIcon,
  Settings,
  Puzzle,
  ShieldAlert,
} from "@admin/components/icons";
import type { ActiveNavSection } from "@admin/constants/nav-sections";
import { SIDEBAR_NAVIGATION } from "@admin/constants/navigation";
import { ROUTES } from "@admin/constants/routes";

import { CONTENT_RAIL_ID } from "./lib/content-rail";

/**
 * A rail entry that can be active.
 *
 * An alias of the canonical type rather than a restatement of it, so the
 * sidebar and the route registry cannot come to disagree about the vocabulary.
 */
export type MainMenuCategory = ActiveNavSection;

/**
 * A rail item's id: a section, or the Content item, which stands for the
 * `collections` and `singles` sections together (`lib/content-rail.ts`).
 */
export type RailItemId = MainMenuCategory | typeof CONTENT_RAIL_ID;

export interface MainMenuItem {
  id: RailItemId;
  label: string;
  icon: React.ElementType;
  href: string;
  /**
   * The permission the reader must hold for this entry to appear.
   *
   * Declared on the entry rather than decided by the rail, so adding a gated
   * destination needs no new branch anywhere: the filter reads whatever is
   * here. An entry without one is shown to everybody, which is right for the
   * sections whose own contents are already filtered.
   *
   * A LIST is any-of, matching `NavigationItem` — that is how an umbrella
   * permission is expressed, and narrowing it here would make the two
   * declarations disagree about the same field.
   */
  requiredPermission?: string | string[];
}

/**
 * The canonical declaration of a destination that also has a rail entry.
 *
 * The rail and `SIDEBAR_NAVIGATION` are two views of one navigation model, and
 * the richer one is the canonical list — it carries the title, icon, href and
 * permission, and the route registry names its sections. Restating those in the
 * rail is the "one question, several implementations" shape: they agree the day
 * they are written and a later route or label change moves only one of them,
 * silently.
 *
 * Returns `undefined` rather than throwing, so a mistake cannot white-screen the
 * admin at import time. `releases-nav.test.ts` asserts every declarable section
 * has a rail entry, so the mistake fails a named test instead.
 */
function canonical(href: string) {
  return SIDEBAR_NAVIGATION.find(item => item.href === href);
}

/**
 * The rail entry for Releases, DERIVED from that declaration.
 *
 * Only the `id` is the rail's own — it is the active-section vocabulary rather
 * than a property of the destination, and `NavigationItem.category` is a wider
 * union that includes values (`main`, `builder`) which are not rail ids.
 */
const releasesNav = canonical(ROUTES.RELEASES);
const releasesRail: MainMenuItem[] = releasesNav
  ? [
      {
        id: "releases",
        label: releasesNav.title,
        icon: releasesNav.icon,
        href: releasesNav.href ?? ROUTES.RELEASES,
        requiredPermission: releasesNav.requiredPermission,
      },
    ]
  : [];

/** The rail entry for the Email hub, derived the same way. */
const emailNav = canonical(ROUTES.EMAIL);
const emailRail: MainMenuItem[] = emailNav
  ? [
      {
        id: "email",
        label: emailNav.title,
        icon: emailNav.icon,
        href: emailNav.href ?? ROUTES.EMAIL,
        requiredPermission: emailNav.requiredPermission,
      },
    ]
  : [];

export const MAIN_MENU_ITEMS: MainMenuItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    href: ROUTES.DASHBOARD,
  },
  // One item for both content sections: finding a piece of content and
  // editing it is one job, whether it is a collection entry or a Single. Its
  // panel switches between the two (`ContentPanel`).
  { id: CONTENT_RAIL_ID, label: "Content", icon: Feather, href: "#" },
  { id: "media", label: "Media Library", icon: ImageIcon, href: ROUTES.MEDIA },
  // Beside Media rather than under Settings: a release is editorial work on a
  // schedule, and Settings is where configuration lives — filing a daily tool
  // there puts it in the place people visit least. Spread rather than written
  // out, because every field of it comes from the canonical declaration.
  ...releasesRail,
  // A top-level entry, mirroring Media: a real `href`, so the rail navigates
  // rather than opening a panel. It belongs here and not under Collections
  // because a translator's question is "what needs me, anywhere" — the page
  // exists precisely to cross collection boundaries, so filing it inside one
  // would hide the only view that does not belong to a single collection.
  {
    id: "translations",
    label: "Translations",
    icon: Languages,
    href: ROUTES.TRANSLATIONS,
  },
  // Email is its own area rather than two pages under Settings: what a site
  // sends, how it looks and how it goes out are one subject, and a reader
  // checking a password reset should not have to know it is "configuration".
  ...emailRail,
  { id: "plugins", label: "Plugins", icon: Puzzle, href: "#" },
  // User management (Users, User Fields, Roles) lives under Settings now —
  // there is no dedicated top-level icon for it.
  { id: "settings", label: "Settings", icon: Settings, href: ROUTES.SETTINGS },
  {
    id: "builders",
    label: "Builders",
    icon: ShieldAlert,
    href: ROUTES.BUILDER_COLLECTIONS,
  },
];

// Plugins is always listed, including on an install with none registered. The
// entry is the only route to `/admin/plugins`, which is the installed-plugins
// list; hiding it until a plugin exists leaves a new install unable to reach
// that page at all.
export const getFilteredMenuItems = (showBuilder: boolean): MainMenuItem[] =>
  MAIN_MENU_ITEMS.filter(item => {
    if (item.id === "builders" && !showBuilder) return false;
    return true;
  });
