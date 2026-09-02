import {
  CalendarClock,
  FileText,
  Image,
  LayoutDashboard,
  Key,
  Languages,
  Layers,
  Mail,
  Puzzle,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
  Webhook,
  type LucideIcon,
} from "../components/icons";
import { apiKeyGrantsFor } from "../lib/permissions/api-key-actions";

import { ROUTES } from "./routes";

/**
 * Navigation category types
 * Used to group navigation items into logical sections in the sidebar
 *
 * - `main`: Dashboard (ungrouped, always first, NIS)
 * - `collections`: Content collection items (dynamic — DynamicCollectionNav)
 * - `singles`: Single items (dynamic — DynamicSingleNav)
 * - `media`: Media Library (standalone, NIS)
 * - `plugins`: Plugin entries (dynamic — DynamicPluginNav)
 * - `settings`: Configuration pages (grouped sub-sections: system, email) plus
 *   User Management (Users, Roles, Custom Fields), which moved here from the
 *   former standalone Users section.
 * - `builder`: Developer tools (Collections, Singles, Field Groups) — untouched
 */
export type NavigationCategory =
  | "main"
  | "collections"
  | "singles"
  | "media"
  | "releases"
  | "translations"
  | "plugins"
  | "settings"
  | "builder";

/**
 * Navigation sub-item definition
 */
export interface NavigationSubItem {
  title: string;
  href: string;
  icon?: LucideIcon;
}

/**
 * Navigation item definition
 * Can be a simple link or an accordion with sub-items
 *
 * @property category - Logical grouping for sidebar sections
 * @property title - Display name of the navigation item
 * @property href - Route path (optional for accordion items)
 * @property icon - Lucide icon component
 * @property type - Item type (accordion for expandable items)
 * @property subItems - Child navigation items (for accordion type)
 * @property subGroup - Sub-group label for grouped sections (e.g., "system" for System Settings)
 * @property requiredPermission - Permission slug required to view this item (optional, always visible if omitted)
 */
export interface NavigationItem {
  title: string;
  href?: string;
  icon: LucideIcon;
  category: NavigationCategory;
  type?: "accordion";
  subItems?: NavigationSubItem[];
  /** Sub-group label for grouped sections (e.g., "system" for System Settings) */
  subGroup?: string;
  /**
   * Permission required to view this item. A single slug, or a list treated as
   * any-of (holding any one shows the item — models an umbrella permission).
   * Items without this are always visible.
   */
  requiredPermission?: string | string[];
}

/**
 * Type for the complete sidebar navigation structure
 */
export type SidebarNavigation = NavigationItem[];

/**
 * Dashboard sidebar navigation configuration
 *
 * Defines the structure of the main navigation menu in the dashboard sidebar.
 * Items are grouped by category into sidebar sections:
 * - main: Dashboard (NIS)
 * - media: Media Library (NIS)
 * - settings: General, API Keys, Email Providers, Email Templates, plus User
 *   Management (Users, Roles, Custom Fields) (IS with sub-groups)
 * - builder: Collections, Singles, Field Groups (IS)
 *
 * Dynamic items (collections, singles, plugins) are rendered by their
 * respective DynamicNav components and are not listed here.
 */
/**
 * The grants that reveal the Releases section, as ANY-OF.
 *
 * Named because three places gate on it — the nav item, the list route and the
 * detail route — and they must agree. Assembling or scheduling implies reading:
 * the three permissions are seeded independently, and the service applies the
 * same implication, so a role holding only `create` can create a release
 * through the API and must be able to see the one it just made.
 */
/**
 * The grants that reach the API Keys list, as ANY-OF.
 *
 * Named because four places gate on it and they must agree: the route, the
 * panel entry, the landing resolver, and the umbrella deciding whether the
 * Settings rail appears at all.
 *
 * Read off the API rather than chosen here. `requireApiKeyPermission` accepts
 * the action's own grant OR `update-api-keys`, so listing keys answers to
 * read-or-update. The route demanded `update-api-keys` alone, which was
 * narrower than the endpoint behind it: a reader holding `read-api-keys` could
 * fetch the list over the API and was turned away from the page that displays
 * it. `create-api-keys` is deliberately absent — it opens the create form, not
 * the list this entry links to.
 */
export const API_KEYS_LIST_PERMISSIONS = apiKeyGrantsFor("read");

export const RELEASE_SECTION_PERMISSIONS = [
  "read-content-releases",
  "create-content-releases",
  "publish-content-releases",
];

export const SIDEBAR_NAVIGATION: SidebarNavigation = [
  // === MAIN (NIS) ===
  {
    title: "Dashboard",
    href: ROUTES.DASHBOARD,
    icon: LayoutDashboard,
    category: "main",
    // No requiredPermission — Dashboard is always accessible
  },

  // === MEDIA (NIS) ===
  {
    title: "Media Library",
    href: ROUTES.MEDIA,
    icon: Image,
    category: "media",
    requiredPermission: "read-media",
  },

  // === RELEASES ===
  // Beside Media rather than under Settings: a release is editorial work on a
  // schedule, and Settings is where configuration lives — filing a daily tool
  // there puts it in the place people visit least.
  {
    title: "Releases",
    href: ROUTES.RELEASES,
    icon: CalendarClock,
    category: "releases",
    // The resource is `content-releases`, NOT `releases`: registering the
    // shorter name would reserve a word real sites use for content, and "press
    // releases" is among the most common collections on a corporate site.
    // Seeded and already listed among the system resources, so this filters
    // rather than hiding the item from everyone.
    // Any of the three. Assembling or scheduling implies reading — the grants
    // are seeded independently, so a role given only `create` would otherwise
    // be able to create releases through the API and never see one.
    requiredPermission: RELEASE_SECTION_PERMISSIONS,
  },

  // === TRANSLATIONS ===
  // No `requiredPermission`: the page lists only what the caller may already
  // read, and every row is filtered by the collection's own read rules. Gating
  // the entry on a permission that does not exist would hide it from everyone.
  {
    title: "Translations",
    href: ROUTES.TRANSLATIONS,
    icon: Languages,
    category: "translations",
  },

  // === USERS (now filed under the settings section — no standalone Users icon) ===
  {
    title: "Users",
    href: ROUTES.USERS,
    icon: Users,
    category: "settings",
    requiredPermission: "read-users",
  },
  {
    title: "Roles",
    href: ROUTES.SECURITY_ROLES,
    icon: Shield,
    category: "settings",
    requiredPermission: "read-roles",
  },
  {
    title: "Custom Fields",
    href: ROUTES.USERS_FIELDS,
    icon: SlidersHorizontal,
    category: "settings",
    requiredPermission: "manage-settings",
  },

  // === SETTINGS (IS with sub-groups) ===
  {
    title: "General",
    href: ROUTES.SETTINGS,
    icon: Settings,
    category: "settings",
    subGroup: "system",
    requiredPermission: "manage-settings",
  },
  {
    title: "API Keys",
    href: ROUTES.SETTINGS_API_KEYS,
    icon: Key,
    category: "settings",
    subGroup: "system",
    requiredPermission: "update-api-keys",
  },
  {
    title: "Webhooks",
    href: ROUTES.SETTINGS_WEBHOOKS,
    icon: Webhook,
    category: "settings",
    subGroup: "system",
    // Any webhook grant reveals the item and the list route accepts them all —
    // read/update view the list, create reaches the create form from there.
    requiredPermission: ["read-webhooks", "update-webhooks", "create-webhooks"],
  },
  {
    title: "Email Providers",
    href: ROUTES.SETTINGS_EMAIL_PROVIDERS,
    icon: Mail,
    category: "settings",
    subGroup: "email",
    requiredPermission: "manage-settings",
  },
  {
    title: "Email Templates",
    href: ROUTES.SETTINGS_EMAIL_TEMPLATES,
    icon: FileText,
    category: "settings",
    subGroup: "email",
    requiredPermission: "manage-settings",
  },

  // === BUILDER (IS) ===
  {
    title: "Collections",
    href: ROUTES.BUILDER_COLLECTIONS,
    icon: Layers,
    category: "builder",
  },
  {
    title: "Singles",
    href: ROUTES.BUILDER_SINGLES,
    icon: FileText,
    category: "builder",
  },
  {
    title: "Field Groups",
    href: ROUTES.BUILDER_FIELD_GROUPS,
    icon: Puzzle,
    category: "builder",
  },
];
