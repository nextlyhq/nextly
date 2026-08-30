import {
  CalendarClock,
  LayoutDashboard,
  Languages,
  Layers,
  Image as ImageIcon,
  Settings,
  Puzzle,
  ShieldAlert,
  FileText,
} from "@admin/components/icons";
import type { ActiveNavSection } from "@admin/constants/nav-sections";
import { ROUTES } from "@admin/constants/routes";

/**
 * A rail entry that can be active.
 *
 * An alias of the canonical type rather than a restatement of it, so the
 * sidebar and the route registry cannot come to disagree about the vocabulary.
 */
export type MainMenuCategory = ActiveNavSection;

export interface MainMenuItem {
  id: MainMenuCategory;
  label: string;
  icon: React.ElementType;
  href: string;
  /**
   * The permission slug the reader must hold for this entry to appear.
   *
   * Declared on the entry rather than decided by the rail, so adding a gated
   * destination needs no new branch anywhere: the filter reads whatever is
   * here. An entry without one is shown to everybody, which is right for the
   * sections whose own contents are already filtered.
   */
  requiredPermission?: string;
}

export const MAIN_MENU_ITEMS: MainMenuItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    href: ROUTES.DASHBOARD,
  },
  { id: "collections", label: "Collections", icon: Layers, href: "#" },
  { id: "singles", label: "Singles", icon: FileText, href: "#" },
  { id: "media", label: "Media Library", icon: ImageIcon, href: ROUTES.MEDIA },
  // Beside Media rather than under Settings: a release is editorial work on a
  // schedule, and Settings is where configuration lives — filing a daily tool
  // there puts it in the place people visit least.
  //
  // The slug is `read-content-releases`. The resource is `content-releases` and
  // not `releases`, because registering the shorter name would reserve a word
  // real sites use for content — "press releases" is among the most common
  // collections on a corporate site.
  {
    id: "releases",
    label: "Releases",
    icon: CalendarClock,
    href: ROUTES.RELEASES,
    requiredPermission: "read-content-releases",
  },
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
export const getFilteredMenuItems = (showBuilder: boolean) =>
  MAIN_MENU_ITEMS.filter(item => {
    if (item.id === "builders" && !showBuilder) return false;
    return true;
  });
