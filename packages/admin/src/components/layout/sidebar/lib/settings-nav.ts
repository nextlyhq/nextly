/**
 * The Settings panel's navigation, declared as data.
 *
 * Order is the order of this list, so changing it is a data edit rather than
 * moving JSX. Each destination states its own visibility gate once, and a
 * group's heading is DERIVED from whether any of its destinations survive that
 * gate — a group that computes its own heading condition alongside its items is
 * a second answer to the same question, and the two drift the moment an item is
 * added, showing destinations under no heading to whoever holds only the new
 * permission.
 */
import {
  Activity,
  FileText,
  Image,
  Key,
  List,
  Mail,
  Settings,
  ShieldAlert,
  Users,
  Webhook,
} from "@admin/components/icons";
import { ROUTES } from "@admin/constants/routes";

/**
 * What a destination needs before it is shown.
 *
 * Kept as data rather than a predicate so the whole table stays comparable and
 * assertable without a renderer. `capability` covers the two access answers the
 * panel receives already resolved, because they are computed from more than a
 * single permission name.
 */
export type SettingsNavGate =
  | { kind: "permission"; permission: string }
  | { kind: "capability"; capability: "apiKeys" | "webhooks" };

export interface SettingsNavItem {
  id: string;
  label: string;
  icon: typeof Settings;
  href: string;
  gate: SettingsNavGate;
  /**
   * Match the route exactly instead of by prefix, for a destination whose path
   * is a prefix of its siblings'.
   */
  exact?: boolean;
  /**
   * Sibling routes that own a path nested under this one. Without it, a parent
   * highlights alongside the child the reader actually navigated to.
   */
  excludedBy?: readonly string[];
}

export interface SettingsNavGroup {
  id: string;
  label: string;
  items: readonly SettingsNavItem[];
  /**
   * A plugin contribution slot rendered after this group's own destinations,
   * for plugins that asked to appear beside a particular section.
   */
  pluginPlacement?: "users";
}

/**
 * Configuration of the system comes before configuration of the people in it.
 *
 * The two groups that configure the installation sit together rather than being
 * separated by the group that administers accounts, which is also the split
 * every comparable admin makes: Strapi declares its global application settings
 * ahead of its administration-panel settings, and Directus keeps project
 * settings apart from roles and permissions.
 */
export const SETTINGS_NAV: readonly SettingsNavGroup[] = [
  {
    id: "system",
    label: "System Settings",
    items: [
      {
        id: "general",
        label: "General",
        icon: Settings,
        href: ROUTES.SETTINGS,
        gate: { kind: "permission", permission: "manage-settings" },
        exact: true,
      },
      {
        id: "api-keys",
        label: "API Keys",
        icon: Key,
        href: ROUTES.SETTINGS_API_KEYS,
        gate: { kind: "capability", capability: "apiKeys" },
      },
      {
        id: "webhooks",
        label: "Webhooks",
        icon: Webhook,
        href: ROUTES.SETTINGS_WEBHOOKS,
        gate: { kind: "capability", capability: "webhooks" },
      },
      {
        id: "background-jobs",
        label: "Background Jobs",
        icon: Activity,
        href: ROUTES.SETTINGS_BACKGROUND_JOBS,
        // The same permission the queue trigger takes. `lastError` carries
        // whatever a handler threw, which is internal detail rather than
        // content, and there is no seeded read-only slug to gate on — inventing
        // one here would change what preset roles grant as a side effect of
        // adding a screen.
        gate: { kind: "permission", permission: "manage-background-jobs" },
      },
      {
        id: "image-sizes",
        label: "Image Sizes",
        icon: Image,
        href: ROUTES.SETTINGS_IMAGE_SIZES,
        gate: { kind: "permission", permission: "manage-settings" },
      },
    ],
  },
  {
    id: "email",
    label: "Email Configuration",
    items: [
      {
        id: "email-providers",
        label: "Providers",
        icon: Mail,
        href: ROUTES.SETTINGS_EMAIL_PROVIDERS,
        gate: { kind: "permission", permission: "manage-email-providers" },
      },
      {
        id: "email-templates",
        label: "Templates",
        icon: FileText,
        href: ROUTES.SETTINGS_EMAIL_TEMPLATES,
        gate: { kind: "permission", permission: "manage-email-templates" },
      },
    ],
  },
  {
    id: "users",
    label: "User Management",
    pluginPlacement: "users",
    items: [
      {
        id: "users",
        label: "Users",
        icon: Users,
        href: ROUTES.USERS,
        gate: { kind: "permission", permission: "read-users" },
        excludedBy: [ROUTES.USERS_FIELDS],
      },
      {
        id: "user-fields",
        label: "User Fields",
        icon: List,
        href: ROUTES.USERS_FIELDS,
        gate: { kind: "permission", permission: "manage-settings" },
      },
      {
        id: "roles",
        label: "Roles",
        icon: ShieldAlert,
        href: ROUTES.SECURITY_ROLES,
        gate: { kind: "permission", permission: "read-roles" },
      },
    ],
  },
];

export interface SettingsNavAccess {
  hasPermission: (permission: string) => boolean;
  canAccessApiKeys: boolean;
  canAccessWebhooks: boolean;
}

/** Whether one destination is shown to the current reader. */
export function isSettingsNavItemVisible(
  item: SettingsNavItem,
  access: SettingsNavAccess
): boolean {
  if (item.gate.kind === "permission") {
    return access.hasPermission(item.gate.permission);
  }
  return item.gate.capability === "apiKeys"
    ? access.canAccessApiKeys
    : access.canAccessWebhooks;
}

/**
 * The panel as this reader sees it: destinations they may reach, and only the
 * groups that still contain one.
 *
 * A group carrying a plugin slot is kept even when its own destinations are all
 * hidden, because the slot's contents are gated by the plugin rather than by
 * this table and dropping the group would hide them on a permission they do not
 * depend on.
 */
export function visibleSettingsNav(
  access: SettingsNavAccess,
  nav: readonly SettingsNavGroup[] = SETTINGS_NAV
): SettingsNavGroup[] {
  return nav
    .map(group => ({
      ...group,
      items: group.items.filter(item => isSettingsNavItemVisible(item, access)),
    }))
    .filter(group => group.items.length > 0 || group.pluginPlacement);
}

/** Any grant that reaches the API-keys screen; the panel gates it as a capability. */
const API_KEY_SLUGS = [
  "read-api-keys",
  "create-api-keys",
  "update-api-keys",
  "delete-api-keys",
] as const;

/** Any grant that reaches the webhooks screen, for the same reason. */
const WEBHOOK_SLUGS = [
  "read-webhooks",
  "update-webhooks",
  "create-webhooks",
] as const;

/**
 * Every grant that reaches SOMETHING in the Settings panel.
 *
 * Read off the table rather than listed beside it, and consumed by three
 * separate decisions that were each maintained by hand: whether the rail entry
 * appears, whether `/admin/settings` opens at all, and which destination a
 * viewer without `manage-settings` lands on. Background Jobs was added to the
 * panel and to none of the three, so the destination passed its own gate while
 * the rail was suppressed — and once the rail was fixed, the link led to a page
 * that bounced. A destination added here now satisfies all three by
 * construction.
 *
 * User Management is excluded deliberately. Those destinations answer to
 * `canViewUsers` and `canViewRoles`, which the rail consults separately, and
 * folding them in would widen every consumer of the settings capability to
 * anybody who may read users.
 */
export function settingsPanelSlugs(): string[] {
  const slugs = new Set<string>();
  for (const group of SETTINGS_NAV) {
    if (group.id === "users") continue;
    for (const item of group.items) {
      if (item.gate.kind === "permission") {
        slugs.add(item.gate.permission);
        continue;
      }
      for (const slug of item.gate.capability === "apiKeys"
        ? API_KEY_SLUGS
        : WEBHOOK_SLUGS) {
        slugs.add(slug);
      }
    }
  }
  return [...slugs];
}
