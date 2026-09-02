import { useQuery } from "@tanstack/react-query";

import { SETTINGS_NAV } from "../components/layout/sidebar/lib/settings-nav";
import { SYSTEM_RESOURCE_SET } from "../constants/permissions";
import { protectedApi } from "../lib/api/protectedApi";
import type {
  AdminCapabilities,
  CollectionCapabilities,
  UserPermissionsResponse,
} from "../types/permissions";

import { useRouter } from "./useRouter";

/**
 * System resources that are NOT dynamic collections.
 * Permissions for these resources map to dedicated capability flags
 * rather than per-collection capabilities.
 */
/**
 * Built-in resources, derived from the single admin definition.
 *
 * Was a hand-kept copy; see `constants/permissions` for why there is now one.
 */
export const SYSTEM_RESOURCES: ReadonlySet<string> = SYSTEM_RESOURCE_SET;

/**
 * Build AdminCapabilities from a flat list of permission slugs.
 *
 * Permission slugs follow the format "{action}-{resource}"
 * (e.g., "read-users", "create-posts", "manage-settings").
 */
/**
 * The capability shape the admin actually runs on, from a permission list.
 *
 * Exported so a test can derive it the way the product does. A hand-built
 * `AdminCapabilities` literal in a test asserts against a shape nothing
 * produces, and would go on passing after this function stopped setting a flag
 * the test still sets for itself.
 */
/** The flags derived purely from which permission slugs are held. */
type SystemCapabilities = Omit<
  AdminCapabilities,
  "isSuperAdmin" | "canViewCollections" | "collections"
>;

/**
 * Which slugs reveal each system capability, as ANY-OF.
 *
 * A table rather than a chain of boolean expressions, because that is what this
 * actually is: one rule per flag, each a list of slugs. The chain it replaces
 * made adding a slug to the wrong flag invisible — the diff looked identical
 * either way — and made the function one of the most branch-heavy in the admin
 * while expressing nothing more than this.
 *
 * `content-releases` needs an entry for the same reason `webhooks` does: both
 * are SYSTEM resources, so neither appears in the per-collection map, and a
 * generic `action-resource` lookup finds nothing and answers false for a caller
 * who holds the grant.
 */
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
 * The grants that reveal the Settings panel, READ OFF the panel itself.
 *
 * This was a hand-written list beside `SETTINGS_NAV`, and the duplication was
 * not theoretical: Background Jobs was added to the panel, its own gate passed,
 * and the rail above it stayed suppressed for anyone holding only that grant —
 * the page reachable solely by typing its URL, with nothing erroring to say so.
 * A destination added to the table now reveals the panel by construction, so
 * the same omission cannot be made twice.
 *
 * User Management is excluded deliberately. Those destinations answer to
 * `canViewUsers` and `canViewRoles`, which are separate capabilities the rail
 * already consults, and folding them in here would widen every other consumer
 * of `canViewSettings` to anybody who may read users.
 */
function settingsPanelSlugs(): string[] {
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

const SYSTEM_CAPABILITY_SLUGS: Record<
  keyof SystemCapabilities,
  readonly string[]
> = {
  canViewUsers: ["read-users"],
  canViewRoles: ["read-roles"],
  canViewMedia: ["read-media", "manage-media"],
  canViewSettings: settingsPanelSlugs(),
  canViewWebhooks: [...WEBHOOK_SLUGS],
  // Read alone. Unlike webhooks, assembling and publishing releases do not
  // reveal the section on their own — the list is a read, and a caller who may
  // create one but not read them would land on a page that shows nothing.
  // Assembling or scheduling implies reading, matching the server: the three
  // grants are seeded independently, and a role given only `create` would
  // otherwise create releases it could never see.
  canViewReleases: [
    "read-content-releases",
    "create-content-releases",
    "publish-content-releases",
  ],
  canManageUsers: ["create-users", "update-users"],
  canManageRoles: ["create-roles", "update-roles"],
  canManageMedia: ["manage-media"],
  canManageSettings: ["manage-settings"],
  canManageEmailProviders: ["manage-email-providers"],
  canManageEmailTemplates: ["manage-email-templates"],
};

/**
 * Everything, for a super-admin.
 *
 * Named rather than returned inline: it is a fifth of `buildCapabilities` and
 * has nothing to do with the permission parsing that follows it, so keeping it
 * in the function made the interesting half harder to read. Frozen so a caller
 * cannot mutate the shared object into a narrower one for everybody.
 */
const SUPER_ADMIN_CAPABILITIES: AdminCapabilities = Object.freeze({
  isSuperAdmin: true,
  canViewCollections: true,
  canViewUsers: true,
  canViewRoles: true,
  canViewMedia: true,
  canViewSettings: true,
  canViewWebhooks: true,
  canViewReleases: true,
  collections: new Proxy(
    {},
    {
      get: () => ({
        canRead: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
      }),
    }
  ),
  canManageUsers: true,
  canManageRoles: true,
  canManageMedia: true,
  canManageSettings: true,
  canManageEmailProviders: true,
  canManageEmailTemplates: true,
});

export function buildCapabilities(
  permissions: string[],
  isSuperAdmin: boolean
): AdminCapabilities {
  // Super-admin gets everything.
  if (isSuperAdmin) return SUPER_ADMIN_CAPABILITIES;

  const permSet = new Set(permissions);
  const collections: Record<string, CollectionCapabilities> = {};

  // Parse permissions to build per-collection capabilities
  for (const perm of permissions) {
    // Match "action-resource" format, where resource can contain hyphens
    const dashIdx = perm.indexOf("-");
    if (dashIdx === -1) continue;

    const action = perm.slice(0, dashIdx);
    const resource = perm.slice(dashIdx + 1);

    // Skip system resources — they map to dedicated flags
    if (SYSTEM_RESOURCES.has(resource)) continue;

    // Build collection capabilities
    if (!collections[resource]) {
      collections[resource] = {
        canRead: false,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
      };
    }

    if (action === "read") collections[resource].canRead = true;
    if (action === "create") collections[resource].canCreate = true;
    if (action === "update") collections[resource].canUpdate = true;
    if (action === "delete") collections[resource].canDelete = true;
  }

  // Check if user can view any collection
  const canViewCollections = Object.values(collections).some(c => c.canRead);

  const holdsAny = (slugs: readonly string[]): boolean =>
    slugs.some(slug => permSet.has(slug));

  return {
    isSuperAdmin: false,
    canViewCollections,
    collections,
    // Every flag below is ANY-OF over the slugs that reveal it, so the table is
    // the whole rule and this loop is the whole evaluation. Written as twenty
    // chained `||` expressions it was one function with twenty branches, and a
    // slug could be added to the wrong flag without the shape of the change
    // making that visible.
    ...(Object.fromEntries(
      Object.entries(SYSTEM_CAPABILITY_SLUGS).map(([flag, slugs]) => [
        flag,
        holdsAny(slugs),
      ])
    ) as SystemCapabilities),
  };
}

/** Default capabilities (no access) shown while loading */
const EMPTY_CAPABILITIES: AdminCapabilities = {
  isSuperAdmin: false,
  canViewCollections: false,
  canViewUsers: false,
  canViewRoles: false,
  canViewMedia: false,
  canViewSettings: false,
  canViewWebhooks: false,
  canViewReleases: false,
  collections: {},
  canManageUsers: false,
  canManageRoles: false,
  canManageMedia: false,
  canManageSettings: false,
  canManageEmailProviders: false,
  canManageEmailTemplates: false,
};

/**
 * Hook to fetch and cache the current user's resolved permissions.
 *
 * Returns an `AdminCapabilities` object with boolean flags for
 * sidebar filtering, route guards, and action visibility.
 *
 * - Super-admin users get all capabilities as `true` (short-circuit).
 * - Other users get capabilities computed from their resolved permission slugs.
 * - Cached via TanStack Query with 5-minute stale time (global default).
 *
 * @example
 * ```tsx
 * const { capabilities, isLoading, hasPermission } = useCurrentUserPermissions();
 *
 * if (capabilities.canViewUsers) {
 *   // Show users nav item
 * }
 *
 * if (hasPermission('read-posts')) {
 *   // Show posts section
 * }
 * ```
 */
export function useCurrentUserPermissions() {
  // Gate the protected fetch on the current route being private. During a
  // navigation transition from /admin to a public route (or before the
  // router has hydrated), Suspense can keep this hook mounted briefly --
  // without the gate, `refetchOnWindowFocus` could fire `/me/permissions`
  // on a route where 401s are expected by design, surfacing benign errors
  // to operators.
  const { route } = useRouter();
  const isPrivateRoute = route?.routeType === "private";

  // The `/me/permissions` endpoint returns the canonical
  // UserPermissionsResponse shape directly, so `data` here IS the
  // permissions payload.
  const { data, isLoading, isPending, error } =
    useQuery<UserPermissionsResponse>({
      queryKey: ["currentUserPermissions"],
      queryFn: () =>
        protectedApi.get<UserPermissionsResponse>("/me/permissions"),
      enabled: isPrivateRoute,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    });

  const permissions = data?.permissions ?? [];
  const isSuperAdmin = data?.isSuperAdmin ?? false;
  const roles = data?.roles ?? [];

  const capabilities = data
    ? buildCapabilities(permissions, isSuperAdmin)
    : EMPTY_CAPABILITIES;

  /**
   * Check if the current user has a specific permission by slug.
   * Super-admin always returns true.
   */
  const hasPermission = (slug: string): boolean => {
    if (isSuperAdmin) return true;
    return permissions.includes(slug);
  };

  /**
   * Check if the current user can perform an action on a collection.
   * Useful for dynamic collection permission checks.
   */
  const canAccessCollection = (
    collectionSlug: string,
    action: "read" | "create" | "update" | "delete"
  ): boolean => {
    if (isSuperAdmin) return true;
    return permissions.includes(`${action}-${collectionSlug}`);
  };

  return {
    capabilities,
    permissions,
    roles,
    isSuperAdmin,
    isLoading: isLoading || isPending,
    error,
    hasPermission,
    canAccessCollection,
  };
}
