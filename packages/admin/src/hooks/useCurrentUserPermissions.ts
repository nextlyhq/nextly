import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { settingsPanelSlugs } from "../components/layout/sidebar/lib/settings-nav";
import { LOCALE_PARAM } from "../constants/search-params";
import { protectedApi } from "../lib/api/protectedApi";
import type {
  AdminCapabilities,
  CapabilitiesResponse,
  CollectionCapabilities,
  UserPermissionsResponse,
} from "../types/permissions";

import {
  CURRENT_USER_PERMISSIONS_KEY,
  currentUserCapabilitiesKey,
} from "./current-user-access";
import { useLocaleParam } from "./useLocaleParam";
import { useRouter } from "./useRouter";

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
const SYSTEM_CAPABILITY_SLUGS: Record<
  keyof SystemCapabilities,
  readonly string[]
> = {
  canViewUsers: ["read-users"],
  canViewRoles: ["read-roles"],
  canViewMedia: ["read-media", "manage-media"],
  canViewSettings: settingsPanelSlugs(),
  canViewWebhooks: ["read-webhooks", "update-webhooks", "create-webhooks"],
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
        canPublish: true,
        canUnpublish: true,
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

/**
 * What the user may do with each collection and Single, as the server's
 * answer states it. No answer yet means nothing is known, so nothing is
 * offered: the map stays empty rather than guessed from permission slugs,
 * which cannot see a collection's code rules.
 */
function collectionsFrom(
  answer: CapabilitiesResponse | undefined
): Record<string, CollectionCapabilities> {
  const collections: Record<string, CollectionCapabilities> = {};
  for (const [slug, entity] of Object.entries(answer?.entities ?? {})) {
    collections[slug] = {
      canRead: entity.read,
      canCreate: entity.create ?? false,
      canUpdate: entity.update,
      canDelete: entity.delete ?? false,
      canPublish: entity.publish,
      canUnpublish: entity.unpublish,
    };
  }
  return collections;
}

/**
 * The capabilities the admin runs on: the collection and Single answers from
 * the server's `answer`, and the system flags from the permission slugs, which
 * also name resources the answer does not (webhooks, releases, the settings
 * panels).
 *
 * Exported so a test can derive it the way the product does. A hand-built
 * `AdminCapabilities` literal in a test asserts against a shape nothing
 * produces, and would go on passing after this function stopped setting a flag
 * the test still sets for itself.
 */
export function buildCapabilities(
  permissions: string[],
  isSuperAdmin: boolean,
  answer: CapabilitiesResponse | undefined
): AdminCapabilities {
  // Super-admin gets everything.
  if (isSuperAdmin) return SUPER_ADMIN_CAPABILITIES;

  const permSet = new Set(permissions);
  const collections = collectionsFrom(answer);

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

/** The longest delay a browser timer holds without overflowing. */
const MAX_TIMER_MS = 2_147_483_647;

/** The shortest wait before asking again about an answer past its end. */
const MIN_RECHECK_MS = 1_000;

/** The capability flag each action is answered by. */
const CAPABILITY_OF_ACTION = {
  read: "canRead",
  create: "canCreate",
  update: "canUpdate",
  delete: "canDelete",
  publish: "canPublish",
  unpublish: "canUnpublish",
} as const satisfies Record<string, keyof CollectionCapabilities>;

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

/** Where an answer the hook asks for stands. */
type AnswerState = {
  isLoading: boolean;
  error: Error | null;
  /**
   * Whether a current answer is in hand. A failed first request leaves it
   * empty, which reads exactly like a user who may do nothing, so a guard
   * must ask this before treating "not allowed" as a refusal. A failed
   * refresh keeps the last answer, which still counts until the role
   * assignment it was given for ends.
   */
  hasAnswer: boolean;
};

/** What {@link useCurrentUserPermissions} returns. */
type CurrentUserPermissions = AnswerState & {
  capabilities: AdminCapabilities;
  permissions: string[];
  roles: string[];
  isSuperAdmin: boolean;
  /**
   * Where the server's answer about collections and Singles stands, apart
   * from the permission list the other fields describe: a content-registry
   * failure leaves the system sections, which the permission list decides,
   * as they were.
   */
  content: AnswerState;
  /** Ask for the permissions and capabilities again, after a failure. */
  retry: () => void;
  hasPermission: (slug: string) => boolean;
  canAccessCollection: (
    collectionSlug: string,
    action: "read" | "create" | "update" | "delete" | "publish" | "unpublish"
  ) => boolean;
};

/**
 * Where one query's answer stands, once the role assignment it was given for
 * may have ended: an answer that arrived before `expiredAt` no longer counts,
 * and its refresh is what is being waited for.
 */
function answerState(
  query: Pick<
    UseQueryResult<unknown>,
    "data" | "dataUpdatedAt" | "error" | "isFetching" | "isPending"
  >,
  expiredAt: number | null
): AnswerState {
  const expired = expiredAt !== null && query.dataUpdatedAt < expiredAt;
  return {
    isLoading: query.isPending || (expired && query.isFetching),
    error: query.error,
    hasAnswer: query.data !== undefined && !expired,
  };
}

/**
 * Hook to fetch and cache the current user's resolved permissions.
 *
 * Returns an `AdminCapabilities` object with boolean flags for
 * sidebar filtering, route guards, and action visibility.
 *
 * - Super-admin users get all capabilities as `true` (short-circuit).
 * - The system flags come from the user's permission slugs; what the user may
 *   do with each collection and Single comes from the server's answer.
 *
 * @example
 * ```tsx
 * const { capabilities, isLoading, canAccessCollection } = useCurrentUserPermissions();
 *
 * if (capabilities.canViewUsers) {
 *   // Show users nav item
 * }
 *
 * if (canAccessCollection("posts", "create")) {
 *   // Offer a new post
 * }
 * ```
 */
export function useCurrentUserPermissions(): CurrentUserPermissions {
  // Gate the protected fetch on the current route being private. During a
  // navigation transition from /admin to a public route (or before the
  // router has hydrated), Suspense can keep this hook mounted briefly --
  // without the gate, `refetchOnWindowFocus` could fire `/me/permissions`
  // on a route where 401s are expected by design, surfacing benign errors
  // to operators.
  const { route } = useRouter();
  const isPrivateRoute = route?.routeType === "private";
  // The content language on screen: a rule can answer by language, so the
  // answer is asked for, and kept, per language, as the screen's own
  // requests are sent.
  const locale = useLocaleParam(LOCALE_PARAM);

  // The `/me/permissions` endpoint returns the canonical
  // UserPermissionsResponse shape directly, so `data` here IS the
  // permissions payload.
  const permissionsQuery = useQuery<UserPermissionsResponse>({
    queryKey: CURRENT_USER_PERMISSIONS_KEY,
    queryFn: () => protectedApi.get<UserPermissionsResponse>("/me/permissions"),
    enabled: isPrivateRoute,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const { data, refetch } = permissionsQuery;

  // What the server decides the user may do with each collection and Single,
  // code rules included. One answer covers every entity, so it is costly to
  // compute and is shared by every caller of this hook: it is asked again
  // only on focus, when a role assignment ends, and when the admin changes
  // roles, permissions, role assignments or the schema, not each time
  // another component mounts.
  const answer = useQuery<CapabilitiesResponse>({
    queryKey: currentUserCapabilitiesKey(locale),
    queryFn: () =>
      protectedApi.get<CapabilitiesResponse>(
        locale === undefined
          ? "/me/capabilities"
          : `/me/capabilities?locale=${encodeURIComponent(locale)}`
      ),
    enabled: isPrivateRoute,
    staleTime: Infinity,
    refetchOnWindowFocus: "always",
  });
  const refetchAnswer = answer.refetch;

  // The answer stops holding when the soonest role assignment ends, and so
  // does the permission list beside it. Then both are asked again, and until
  // a fresh answer arrives neither counts: a failed refresh must not leave
  // the admin offering what an ended role allowed.
  const validUntil = answer.data?.validUntil ?? null;
  const answeredAt = answer.dataUpdatedAt;
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  useEffect(() => {
    if (validUntil === null) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      const remaining = validUntil - Date.now();
      // Timers overflow past about 24.8 days, so a later end is waited for in
      // steps rather than asked about early.
      if (remaining > MAX_TIMER_MS) {
        timer = setTimeout(arm, MAX_TIMER_MS);
        return;
      }
      timer = setTimeout(
        () => {
          setExpiredAt(Date.now());
          // Every mounted caller arms the same deadline; joining a refresh
          // already under way asks the server once.
          void refetch({ cancelRefetch: false });
          void refetchAnswer({ cancelRefetch: false });
        },
        // An answer already past its end, as a clock ahead of the server's
        // reads it, is asked about again at most once a second.
        Math.max(remaining, MIN_RECHECK_MS)
      );
    };
    arm();
    return () => clearTimeout(timer);
  }, [validUntil, answeredAt, refetch, refetchAnswer]);

  const permissionsState = answerState(permissionsQuery, expiredAt);
  const content = answerState(answer, expiredAt);

  const permissions = permissionsState.hasAnswer
    ? (data?.permissions ?? [])
    : [];
  const isSuperAdmin = permissionsState.hasAnswer
    ? (data?.isSuperAdmin ?? false)
    : false;
  const roles = permissionsState.hasAnswer ? (data?.roles ?? []) : [];

  const capabilities = permissionsState.hasAnswer
    ? buildCapabilities(
        permissions,
        isSuperAdmin,
        content.hasAnswer ? answer.data : undefined
      )
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
   * Whether the current user may perform an action on a collection or
   * Single, as the server answers it.
   */
  const canAccessCollection = (
    collectionSlug: string,
    action: "read" | "create" | "update" | "delete" | "publish" | "unpublish"
  ): boolean => {
    if (isSuperAdmin) return true;
    const entity = capabilities.collections[collectionSlug];
    if (!entity) return false;
    return entity[CAPABILITY_OF_ACTION[action]];
  };

  return {
    capabilities,
    permissions,
    roles,
    isSuperAdmin,
    ...permissionsState,
    content,
    retry: (): void => {
      void refetch();
      void refetchAnswer();
    },
    hasPermission,
    canAccessCollection,
  };
}
