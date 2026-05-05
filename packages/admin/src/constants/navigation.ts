import {
  FileText,
  Image,
  LayoutDashboard,
  LayoutGrid,
  Key,
  Layers,
  Mail,
  Puzzle,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "../components/icons";

import { ROUTES } from "./routes";

/**
 * Navigation category types
 * Used to group navigation items into logical sections in the sidebar
 *
 * - `main`: Dashboard (ungrouped, always first, NIS)
 * - `collections`: Content collection items (dynamic — DynamicCollectionNav)
 * - `singles`: Single items (dynamic — DynamicSingleNav)
 * - `media`: Media Library (standalone, NIS)
 * - `users`: User management section (Users, Roles, Custom Fields)
 * - `plugins`: Plugin entries (dynamic — DynamicPluginNav)
 * - `settings`: Configuration pages (grouped sub-sections: system, email)
 * - `builder`: Developer tools (Collections, Singles, Components) — untouched
 */
export type NavigationCategory =
  | "main"
  | "collections"
  | "singles"
  | "media"
  | "users"
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
  /** Permission slug required to view this item. Items without this are always visible. */
  requiredPermission?: string;
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
 * - users: Users, Roles, Custom Fields (IS)
 * - settings: General, API Keys, Email Providers, Email Templates (IS with sub-groups)
 * - builder: Collections, Singles, Components (IS)
 *
 * Dynamic items (collections, singles, plugins) are rendered by their
 * respective DynamicNav components and are not listed here.
 */
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

  // === USERS (IS) ===
  {
    title: "Users",
    href: ROUTES.USERS,
    icon: Users,
    category: "users",
    requiredPermission: "read-users",
  },
  {
    title: "Roles",
    href: ROUTES.SECURITY_ROLES,
    icon: Shield,
    category: "users",
    requiredPermission: "read-roles",
  },
  {
    title: "Custom Fields",
    href: ROUTES.USERS_FIELDS,
    icon: SlidersHorizontal,
    category: "users",
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
  {
    title: "Email Layout",
    href: ROUTES.SETTINGS_EMAIL_LAYOUT,
    icon: LayoutGrid,
    category: "settings",
    subGroup: "email",
    requiredPermission: "manage-settings",
  },

  // === BUILDER (IS) ===
  {
    title: "Collections",
    href: ROUTES.COLLECTIONS,
    icon: Layers,
    category: "builder",
  },
  {
    title: "Singles",
    href: ROUTES.SINGLES,
    icon: FileText,
    category: "builder",
  },
  {
    title: "Components",
    href: ROUTES.COMPONENTS,
    icon: Puzzle,
    category: "builder",
  },
];
