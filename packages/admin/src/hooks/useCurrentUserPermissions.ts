import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

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
 * Every action on every collection and Single: what the server's answer gives
 * a super-admin, including an entity added since it was asked.
 */
const EVERY_ENTITY: Record<string, CollectionCapabilities> = new Proxy(
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
);

/**
 * Everything, for a super-admin.
 *
 * Named rather than returned inline: it is a fifth of `buildCapabilities` and
 * has nothing to do with the permission parsing that follows it, so keeping it
 * in the function made the interesting half harder to read. Frozen so a caller
 * cannot mutate the shared object into a narrower one for everybody. The
 * collections in it are replaced by the server's answer about them.
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
  collections: EVERY_ENTITY,
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
  // What may be done with each collection and Single is the server's answer
  // alone, its own super-admin verdict included. The permission list is a
  // separate request, and a super-admin standing it still reports after the
  // answer stopped giving one must not grant every entity.
  const collections = answer?.isSuperAdmin
    ? EVERY_ENTITY
    : collectionsFrom(answer);
  const canViewCollections =
    answer?.isSuperAdmin === true ||
    Object.values(collections).some(c => c.canRead);

  // Super-admin gets every system section.
  if (isSuperAdmin) {
    return { ...SUPER_ADMIN_CAPABILITIES, canViewCollections, collections };
  }

  const permSet = new Set(permissions);

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

/**
 * The shortest wait before asking again about an answer fetched after its own
 * end, as a server clock behind this one gives.
 */
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

/** The latest of `ends` that has passed by `now`, or null. */
function latestPassed(ends: readonly number[], now: number): number | null {
  const passed = ends.filter(end => end <= now);
  return passed.length === 0 ? null : Math.max(...passed);
}

/**
 * Where one query's answer stands, once it may no longer hold: an answer that
 * arrived before `endedAt`, the end of the role assignment it was given for,
 * no longer counts, and nor does one a change to roles, permissions,
 * assignments or the schema has `invalidated`, until a newer one arrives.
 */
function answerState(
  query: Pick<
    UseQueryResult<unknown>,
    "data" | "dataUpdatedAt" | "error" | "isFetching" | "isPending"
  >,
  endedAt: number | null,
  invalidated: boolean
): AnswerState {
  const unusable =
    invalidated || (endedAt !== null && query.dataUpdatedAt < endedAt);
  return {
    // An answer that no longer holds is waited on until a current one or an
    // error arrives, before as well as during its refresh: neither the old
    // answer nor its absence is a decision to show.
    isLoading:
      query.isPending ||
      (unusable && (query.isFetching || query.error === null)),
    error: query.error,
    hasAnswer: query.data !== undefined && !unusable,
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
  const queryClient = useQueryClient();
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
  const capabilitiesKey = currentUserCapabilitiesKey(locale);
  const answer = useQuery<CapabilitiesResponse>({
    queryKey: capabilitiesKey,
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
  // Every end an answer has named, kept apart from the answer that named it:
  // a later answer can drop an end (with null, once the ending assignment is
  // gone) before that end arrives, and the other request's answer from before
  // it must still not count once it passes. Recorded in the render that first
  // sees it, so no ordering of responses and timers can lose one.
  const [ends, setEnds] = useState<readonly number[]>([]);
  if (validUntil !== null && !ends.includes(validUntil)) {
    setEnds([...ends, validUntil]);
  }
  const knownEnds = useMemo(
    () =>
      validUntil === null || ends.includes(validUntil)
        ? ends
        : [...ends, validUntil],
    [ends, validUntil]
  );
  // The latest end that has passed, read at render, so an answer already past
  // its end when this mounts never counts, not even until a timer fires.
  const endedAt = latestPassed(knownEnds, Date.now());
  const permissionsAnsweredAt = permissionsQuery.dataUpdatedAt;
  const [, setEndsReached] = useState(0);
  useEffect(() => {
    const askAgain = (): void => {
      setEndsReached(reached => reached + 1);
      // A refresh already under way may have been asked before the end, and
      // its answer would arrive after it looking current, so it is replaced
      // rather than joined: only an answer asked after the end counts.
      void refetch();
      void refetchAnswer();
    };
    const now = Date.now();
    const passed = latestPassed(knownEnds, now);
    // An end has passed and an answer from before it is all there is.
    if (
      passed !== null &&
      (permissionsAnsweredAt < passed || answeredAt < passed)
    ) {
      askAgain();
      return undefined;
    }
    // The next end to come, and, for an answer the server gave after its own
    // end, a check at most once a second for the answer that follows it.
    const upcoming = knownEnds.filter(end => end > now);
    const recheck =
      validUntil !== null && validUntil <= now ? now + MIN_RECHECK_MS : null;
    const at = Math.min(...upcoming, recheck ?? Infinity);
    if (at === Infinity) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      const remaining = at - Date.now();
      // Timers overflow past about 24.8 days, so a later end is waited for in
      // steps rather than asked about early.
      if (remaining > MAX_TIMER_MS) {
        timer = setTimeout(arm, MAX_TIMER_MS);
        return;
      }
      timer = setTimeout(askAgain, Math.max(remaining, 0));
    };
    arm();
    return () => clearTimeout(timer);
  }, [
    knownEnds,
    validUntil,
    answeredAt,
    permissionsAnsweredAt,
    refetch,
    refetchAnswer,
  ]);

  // A change the admin made invalidates both answers; the old ones stop
  // counting then, not once a refresh succeeds, since a refresh that fails
  // would otherwise leave them in place indefinitely.
  const invalidated = (key: readonly unknown[]): boolean =>
    queryClient.getQueryState(key)?.isInvalidated === true;
  const permissionsState = answerState(
    permissionsQuery,
    endedAt,
    invalidated(CURRENT_USER_PERMISSIONS_KEY)
  );
  const content = answerState(answer, endedAt, invalidated(capabilitiesKey));

  const permissions = permissionsState.hasAnswer
    ? (data?.permissions ?? [])
    : [];
  const isSuperAdmin = permissionsState.hasAnswer
    ? (data?.isSuperAdmin ?? false)
    : false;
  const roles = permissionsState.hasAnswer ? (data?.roles ?? []) : [];

  // Each answer decides its own half: the permission list the system flags,
  // and the content answer every collection and Single, so a failure of one
  // takes nothing the other answered offline.
  const capabilities = buildCapabilities(
    permissions,
    isSuperAdmin,
    content.hasAnswer ? answer.data : undefined
  );

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
   * Single, as the server answers it, a super-admin's answer included.
   */
  const canAccessCollection = (
    collectionSlug: string,
    action: "read" | "create" | "update" | "delete" | "publish" | "unpublish"
  ): boolean => {
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
