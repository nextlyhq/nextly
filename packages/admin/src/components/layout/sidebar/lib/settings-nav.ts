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
  Key,
  Mail,
  Settings,
  ShieldAlert,
  Users,
  Webhook,
} from "@admin/components/icons";
import { EMAIL_HUB_PERMISSIONS } from "@admin/constants/email-hub";
import { API_KEYS_LIST_PERMISSIONS } from "@admin/constants/navigation";
import { ROUTES } from "@admin/constants/routes";
import { READ_SETTINGS } from "@admin/lib/permissions/system-policy";

/**
 * What a destination needs before it is shown.
 *
 * Kept as data rather than a predicate so the whole table stays comparable and
 * assertable without a renderer. `anyOf` is for a destination several grants
 * reach, any one of which shows it. `capability` covers the two access answers
 * the panel receives already resolved, because they are computed from more
 * than a single permission name.
 */
export type SettingsNavGate =
  | { kind: "permission"; permission: string }
  | { kind: "anyOf"; permissions: readonly string[] }
  | { kind: "capability"; capability: "apiKeys" | "webhooks" };

export interface SettingsNavItem {
  id: string;
  label: string;
  icon: typeof Settings;
  href: string;
  gate: SettingsNavGate;
  /**
   * The grant the destination's own ROUTE demands, when that is narrower than
   * the gate above.
   *
   * `gate` answers "may this reader see the link"; this answers "may they open
   * it". They are usually the same fact and this is then omitted. Where they
   * differ, a landing decision that consults only `gate` sends someone to a
   * page the route guard refuses, which reads to them as the panel being
   * broken. Any-of when a list, matching `PermissionGuard`.
   */
  routePermission?: string | readonly string[];
  /**
   * Match the route exactly instead of by prefix, for a destination whose path
   * is a prefix of its siblings'.
   */
  exact?: boolean;
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
 * The site itself first, then the people who use it, then the machinery that
 * developers connect to it.
 *
 * Site holds what an owner configures about the installation: its general
 * settings and the email it sends. People holds accounts and what they may do.
 * Developers holds the integration surfaces (API keys, webhooks) and the job
 * queue an operator watches. Plugins' own settings follow all three.
 */
export const SETTINGS_NAV: readonly SettingsNavGroup[] = [
  {
    id: "site",
    label: "Site",
    items: [
      {
        id: "general",
        label: "General",
        icon: Settings,
        href: ROUTES.SETTINGS,
        gate: { kind: "permission", permission: READ_SETTINGS },
        exact: true,
      },
      {
        id: "email",
        label: "Email",
        icon: Mail,
        href: ROUTES.EMAIL,
        // Any grant that shows one of the hub's tabs, which is also what the
        // hub's landing route admits: it moves a reader who may not see
        // Messages on to a tab they may see.
        gate: { kind: "anyOf", permissions: EMAIL_HUB_PERMISSIONS },
      },
    ],
  },
  {
    id: "people",
    label: "People",
    pluginPlacement: "users",
    items: [
      {
        id: "users",
        label: "Users",
        icon: Users,
        href: ROUTES.USERS,
        // Highlighted on the user fields screens too: they are reached from
        // the Users page and their trail runs Settings › Users › Fields.
        gate: { kind: "permission", permission: "read-users" },
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
  {
    id: "developers",
    label: "Developers",
    items: [
      {
        id: "api-keys",
        label: "API Keys",
        icon: Key,
        href: ROUTES.SETTINGS_API_KEYS,
        gate: { kind: "capability", capability: "apiKeys" },
        // Taken from the route's own constant rather than copied, so the two
        // cannot drift in either direction.
        routePermission: API_KEYS_LIST_PERMISSIONS,
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
  switch (item.gate.kind) {
    case "permission":
      return access.hasPermission(item.gate.permission);
    case "anyOf":
      return item.gate.permissions.some(access.hasPermission);
    case "capability":
      return item.gate.capability === "apiKeys"
        ? access.canAccessApiKeys
        : access.canAccessWebhooks;
  }
}

/**
 * Whether a destination is highlighted as the place the reader is.
 *
 * By prefix unless the destination asks for an exact match, so the pages
 * reached from a destination keep it highlighted: an editor under its list,
 * and the user fields screens under Users, whose trail runs through it.
 */
export function isSettingsNavItemActive(
  item: SettingsNavItem,
  isActive: (href: string, exact?: boolean) => boolean
): boolean {
  return isActive(item.href, item.exact);
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

/**
 * Any grant that reaches the API-keys screen.
 *
 * The grants that OPEN it, not every grant naming the resource. `create-` and
 * `delete-api-keys` let a holder act through the API but not list keys, so
 * counting them here offered a rail entry whose only destination turned them
 * away.
 */
const API_KEY_SLUGS = API_KEYS_LIST_PERMISSIONS;

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
 * viewer without `read-settings` lands on. Background Jobs was added to the
 * panel and to none of the three, so the destination passed its own gate while
 * the rail was suppressed — and once the rail was fixed, the link led to a page
 * that bounced. A destination added here now satisfies all three by
 * construction.
 *
 * People is excluded deliberately. Those destinations answer to
 * `canViewUsers` and `canViewRoles`, which the rail consults separately, and
 * folding them in would widen every consumer of the settings capability to
 * anybody who may read users.
 */
export function settingsPanelSlugs(): string[] {
  const slugs = new Set<string>();
  for (const group of SETTINGS_NAV) {
    if (group.id === "people") continue;
    for (const item of group.items) {
      for (const slug of gateSlugs(item.gate)) slugs.add(slug);
    }
  }
  return [...slugs];
}

/** Every grant that satisfies one gate, any one of them sufficing. */
function gateSlugs(gate: SettingsNavGate): readonly string[] {
  switch (gate.kind) {
    case "permission":
      return [gate.permission];
    case "anyOf":
      return gate.permissions;
    case "capability":
      return gate.capability === "apiKeys" ? API_KEY_SLUGS : WEBHOOK_SLUGS;
  }
}
