import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { settingsPanelSlugs } from "../components/layout/sidebar/lib/settings-nav";
import { SYSTEM_RESOURCE_SET } from "../constants/permissions";
import { LOCALE_PARAM } from "../constants/search-params";
import { protectedApi } from "../lib/api/protectedApi";
import type {
  AdminCapabilities,
  CapabilitiesResponse,
  CollectionCapabilities,
  UserPermissionsResponse,
} from "../types/permissions";

import {
  CURRENT_USER_CAPABILITIES_KEY,
  CURRENT_USER_PERMISSIONS_KEY,
  currentUserCapabilitiesKey,
  invalidateCurrentUserAccess,
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
      canReadTranslations: true,
      canReadHistory: true,
      canPublishEveryLanguage: true,
      canUpdateInDefaultLanguage: true,
      canDuplicate: true,
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
 * A cell of the server's answer, or `own` where the answer has none: an older
 * server answers no cell for a request judged in other languages, which the
 * action's own cell then stands for.
 */
function cellOr(cell: boolean | undefined, own: boolean): boolean {
  return cell ?? own;
}

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
    const canCreate = cellOr(entity.create, false);
    collections[slug] = {
      canRead: entity.read,
      // Every create the admin sends names no language, so the server writes
      // it in the default one: that is the create answered here, for the
      // list's New, the create page and the quick-create modal alike.
      canCreate: cellOr(entity.createInDefaultLanguage, canCreate),
      canUpdate: entity.update,
      canDelete: cellOr(entity.delete, false),
      canPublish: entity.publish,
      canUnpublish: entity.unpublish,
      // Each request judged in other languages, as the server judges it.
      canReadTranslations: cellOr(entity.readTranslations, entity.read),
      canReadHistory: cellOr(entity.readHistory, entity.read),
      canPublishEveryLanguage: cellOr(
        entity.publishEveryLanguage,
        entity.publish
      ),
      canUpdateInDefaultLanguage: cellOr(
        entity.updateInDefaultLanguage,
        entity.update
      ),
      canDuplicate: cellOr(entity.duplicate, canCreate),
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

/**
 * How often both answers are asked again while the content answer is
 * missing. That answer carries the end of the soonest role assignment, so
 * without it no end is known and the permission list beside it would
 * otherwise be kept past an end nobody could see coming.
 */
const UNANSWERED_RECHECK_MS = 60_000;

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

/**
 * The capability flag each request judged in other languages is answered by.
 * Not permission slugs: these are asked by name, never parsed from a slug.
 */
const CAPABILITY_OF_REQUEST = {
  readTranslations: "canReadTranslations",
  readHistory: "canReadHistory",
  publishEveryLanguage: "canPublishEveryLanguage",
  updateInDefaultLanguage: "canUpdateInDefaultLanguage",
  duplicate: "canDuplicate",
} as const satisfies Record<string, keyof CollectionCapabilities>;

/** What `canAccessCollection` answers: an action, or a request judged in other languages. */
export type CollectionAccess =
  | keyof typeof CAPABILITY_OF_ACTION
  | keyof typeof CAPABILITY_OF_REQUEST;

/** An action the server's answer about collections and Singles covers. */
type EntityAction = keyof typeof CAPABILITY_OF_ACTION;

function isEntityAction(access: CollectionAccess): access is EntityAction {
  return Object.hasOwn(CAPABILITY_OF_ACTION, access);
}

/** The capability flag that answers `access`. */
function flagOf(access: CollectionAccess): keyof CollectionCapabilities {
  return isEntityAction(access)
    ? CAPABILITY_OF_ACTION[access]
    : CAPABILITY_OF_REQUEST[access];
}

/**
 * The action and resource a permission slug (`<action>-<resource>`) names,
 * when the action is one the server's answer covers and the resource is not
 * built in: such a slug may be about a collection or Single. Null for any
 * other slug, which only the permission list answers. Actions have no hyphen
 * and slugs may, so the slug splits at its first.
 */
function entityPermission(
  slug: string
): { action: EntityAction; resource: string } | null {
  const dash = slug.indexOf("-");
  const action = slug.slice(0, dash);
  const resource = slug.slice(dash + 1);
  if (
    dash <= 0 ||
    resource === "" ||
    !Object.hasOwn(CAPABILITY_OF_ACTION, action) ||
    SYSTEM_RESOURCE_SET.has(resource)
  ) {
    return null;
  }
  return { action: action as EntityAction, resource };
}

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
    action: CollectionAccess
  ) => boolean;
  /**
   * Whether the user may do what a permission slug names: an action on a
   * collection or Single as the server's answer decides it, code rules
   * included, and any other slug from the permission list.
   */
  can: (permission: string) => boolean;
};

/** Whether the content answer has failed and has never answered. */
function contentUnanswered(
  queryClient: ReturnType<typeof useQueryClient>,
  key: readonly unknown[]
): boolean {
  return unansweredAfterFailure(queryClient.getQueryState(key));
}

/**
 * Whether a query's last request failed with no answer that counts: none
 * ever arrived, or the one kept was invalidated by a change. Either way it is
 * asked again on the schedule, which a kept answer would otherwise stop.
 */
function unansweredAfterFailure(
  state: { data?: unknown; error: unknown; isInvalidated: boolean } | undefined
): boolean {
  return (
    state !== undefined &&
    (state.data === undefined || state.isInvalidated) &&
    state.error != null
  );
}

/**
 * When a refresh for a reached end was last asked, per query client: every
 * mounted caller of the hook decides the same step at the same moment, and the
 * first to act asks for all of them, so they do not replace one another's
 * requests or each ask the whole matrix again.
 */
const deadlineAsks = new WeakMap<QueryClient, number>();

/** What the deadline effect does now, for the answers and ends it has. */
type DeadlineStep =
  | { kind: "ask-both"; since: number }
  | { kind: "ask-stale"; list: boolean; answer: boolean }
  | { kind: "wait"; at: number; since: number; atEnd: boolean }
  | { kind: "none" };

/**
 * The deadline effect's decision, apart from the timers and requests that
 * carry it out:
 *
 * - an end has passed and an answer is from before it: ask both again, unless
 *   a refresh for that end was already asked after it, in which case ask only
 *   the halves still from before it;
 * - otherwise wait for the next end to come, or, for an answer the server
 *   gave after its own end, check again at most once a second.
 */
/** What the deadline effect knows when it decides. */
interface DeadlineState {
  ends: readonly number[];
  validUntil: number | null;
  answeredAt: number;
  permissionsAnsweredAt: number;
  askedAt: number | null;
  now: number;
}

function nextDeadlineStep(state: DeadlineState): DeadlineStep {
  return passedEndStep(state) ?? waitingStep(state);
}

/**
 * An end has passed and an answer is from before it: ask both again, unless a
 * refresh for that end was already asked after it, in which case ask only the
 * halves still from before it. Null when no answer is from before a passed end.
 */
function passedEndStep(state: DeadlineState): DeadlineStep | null {
  const passed = latestPassed(state.ends, state.now);
  if (passed === null) return null;
  const list = state.permissionsAnsweredAt < passed;
  const answer = state.answeredAt < passed;
  if (!list && !answer) return null;
  return state.askedAt === null || state.askedAt < passed
    ? { kind: "ask-both", since: passed }
    : { kind: "ask-stale", list, answer };
}

/**
 * The next end to come, or, for an answer the server gave after its own end,
 * a check at most once a second, whichever is sooner.
 */
function waitingStep({ ends, validUntil, now }: DeadlineState): DeadlineStep {
  const next = Math.min(...ends.filter(end => end > now));
  const recheck =
    validUntil !== null && validUntil <= now ? now + MIN_RECHECK_MS : Infinity;
  if (recheck < next) {
    return { kind: "wait", at: recheck, since: now, atEnd: false };
  }
  return next === Infinity
    ? { kind: "none" }
    : { kind: "wait", at: next, since: next, atEnd: true };
}

/** An end an answer named, and when that answer was given. */
interface NamedEnd {
  end: number;
  namedAt: number;
}

/**
 * One answer's word on when the access it was read under ends: the soonest
 * end of a role assignment, or null, and when that answer was asked.
 */
interface EndSource {
  validUntil: number | null;
  answeredAt: number;
}

/**
 * The ends known once `sources` have answered, from the ends known before.
 *
 * Both answers state the same thing, the soonest end of the caller's role
 * assignments, each from its own read. An end is kept once it has passed,
 * and until then while every answer newer than the one that named it names
 * it too: a newer answer that does not says no such end remains, the
 * assignment having been removed or extended. Each answer's own end is added
 * where it is not known yet. Exported so a test can drive it directly.
 */
export function namedEndsAfter(
  ends: readonly NamedEnd[],
  sources: readonly EndSource[],
  now: number
): readonly NamedEnd[] {
  let named = ends.filter(
    ({ end, namedAt }) =>
      end <= now ||
      sources.every(
        ({ validUntil, answeredAt }) =>
          validUntil === end || answeredAt <= namedAt
      )
  );
  for (const { validUntil, answeredAt } of sources) {
    if (validUntil !== null && !named.some(({ end }) => end === validUntil)) {
      named = [...named, { end: validUntil, namedAt: answeredAt }];
    }
  }
  return named;
}

/**
 * Whether two lists name the same ends from the same answers, in order.
 * Compared by value: an end one answer drops and another still names is kept
 * as a new entry of the same end, and comparing entries by identity would set
 * the list again on every render.
 */
function sameEnds(a: readonly NamedEnd[], b: readonly NamedEnd[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (named, index) =>
        named.end === b[index]?.end && named.namedAt === b[index]?.namedAt
    )
  );
}

/**
 * A request's answer, stamped with when it was asked. That moment, not when
 * the answer arrived, says whether the answer could have seen an end: one
 * asked before an end and delivered after it still describes the role before.
 */
async function askedNow<T>(
  request: () => Promise<T>
): Promise<T & { askedAt: number }> {
  const askedAt = Date.now();
  return { ...(await request()), askedAt };
}

/** When an answer was asked; one with no stamp counts as asked long ago. */
const askedAtOf = (data: { askedAt?: number } | undefined): number =>
  data?.askedAt ?? 0;

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
    UseQueryResult<{ askedAt?: number }>,
    "data" | "error" | "isFetching" | "isPending"
  >,
  endedAt: number | null,
  invalidated: boolean
): AnswerState {
  const unusable =
    invalidated || (endedAt !== null && askedAtOf(query.data) < endedAt);
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
  // One key per language, kept stable so the effects below that ask about
  // it run when the language changes and not on every render.
  const capabilitiesKey = useMemo(
    () => currentUserCapabilitiesKey(locale),
    [locale]
  );

  // The `/me/permissions` endpoint returns the canonical
  // UserPermissionsResponse shape directly, so `data` here IS the
  // permissions payload.
  const permissionsQuery = useQuery<
    UserPermissionsResponse & { askedAt: number }
  >({
    queryKey: CURRENT_USER_PERMISSIONS_KEY,
    queryFn: () =>
      askedNow(() =>
        protectedApi.get<UserPermissionsResponse>("/me/permissions")
      ),
    enabled: isPrivateRoute,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    // Asked again on the schedule when its own refresh failed with no answer
    // that counts, and while the content answer has none, whose end it
    // would otherwise be told.
    refetchInterval: query =>
      unansweredAfterFailure(query.state) ||
      contentUnanswered(queryClient, capabilitiesKey)
        ? UNANSWERED_RECHECK_MS
        : false,
  });
  const { data, refetch } = permissionsQuery;

  // What the server decides the user may do with each collection and Single,
  // code rules included. One answer covers every entity, so it is costly to
  // compute and is shared by every caller of this hook: it is asked again
  // only on focus, when a role assignment ends, and when the admin changes
  // roles, permissions, role assignments or the schema, not each time
  // another component mounts.
  const answer = useQuery<CapabilitiesResponse & { askedAt: number }>({
    queryKey: capabilitiesKey,
    queryFn: () =>
      askedNow(() =>
        protectedApi.get<CapabilitiesResponse>(
          locale === undefined
            ? "/me/capabilities"
            : `/me/capabilities?locale=${encodeURIComponent(locale)}`
        )
      ),
    enabled: isPrivateRoute,
    staleTime: Infinity,
    refetchOnWindowFocus: "always",
    // A failed answer is asked again on the schedule below and on focus, not
    // by each caller that mounts: while the content registry is degraded,
    // every mount would otherwise ask the whole matrix again.
    retryOnMount: false,
    refetchInterval: query =>
      unansweredAfterFailure(query.state) ? UNANSWERED_RECHECK_MS : false,
  });
  const refetchAnswer = answer.refetch;
  // A fresh answer in one language is newer than every other language's
  // cached one, which may be from before a change to roles or rules. Those
  // are marked stale without being fetched, so returning to a language asks
  // again rather than restoring its older answer.
  const languageAnsweredAt = answer.dataUpdatedAt;
  // The answer a language already had when the screen moved to it is not
  // news: only one that arrived after that is newer than the other
  // languages', and only that one marks them.
  const seenAnswer = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => {
    const shown = JSON.stringify(capabilitiesKey);
    if (seenAnswer.current?.key !== shown) {
      seenAnswer.current = { key: shown, at: languageAnsweredAt };
      if (languageAnsweredAt !== 0) return;
    }
    if (languageAnsweredAt <= seenAnswer.current.at) return;
    seenAnswer.current.at = languageAnsweredAt;
    const others = {
      queryKey: CURRENT_USER_CAPABILITIES_KEY,
      predicate: (query: { queryKey: readonly unknown[] }) =>
        JSON.stringify(query.queryKey) !== shown,
    };
    // A request still under way for another language was asked before this
    // answer, so it is cancelled rather than let to clear the mark when it
    // lands with what it saw.
    void queryClient
      .cancelQueries(others)
      .then(() =>
        queryClient.invalidateQueries({ ...others, refetchType: "none" })
      );
  }, [languageAnsweredAt, queryClient, capabilitiesKey]);

  // The answer stops holding when the soonest role assignment ends, and so
  // does the permission list beside it. Then both are asked again, and until
  // a fresh answer arrives neither counts: a failed refresh must not leave
  // the admin offering what an ended role allowed.
  const validUntil = answer.data?.validUntil ?? null;
  const answeredAt = askedAtOf(answer.data);
  // The permission list names the same end, from its own read of the roles.
  const permissionsValidUntil = data?.validUntil ?? null;
  const permissionsAnsweredAt = askedAtOf(data);
  // Every end an answer has named, kept apart from the answer that named it:
  // an answer given after an end can drop it (with null, once the ending
  // assignment is gone) before that end's timer has run, and the other
  // request's answer from before it must still not count. An end is retired
  // only by an answer that no longer names it, newer than the one that did,
  // and arriving while the end is still to come: such an answer says no such
  // end remains, the assignment having been removed or extended. One arriving
  // after the end may have been processed after it too, so the end stands
  // and is acted on. An older answer, such as another language's restored
  // from the cache, retires nothing. Kept in the render that first sees it,
  // so no ordering of responses and timers can lose one.
  const [ends, setEnds] = useState<readonly NamedEnd[]>([]);
  const namedEnds = useMemo(
    () =>
      namedEndsAfter(
        ends,
        [
          { validUntil, answeredAt },
          {
            validUntil: permissionsValidUntil,
            answeredAt: permissionsAnsweredAt,
          },
        ],
        Date.now()
      ),
    [ends, validUntil, answeredAt, permissionsValidUntil, permissionsAnsweredAt]
  );
  if (!sameEnds(namedEnds, ends)) {
    setEnds(namedEnds);
  }
  const knownEnds = useMemo(() => namedEnds.map(({ end }) => end), [namedEnds]);
  // The latest end that has passed, read at render, so an answer already past
  // its end when this mounts never counts, not even until a timer fires.
  const endedAt = latestPassed(knownEnds, Date.now());
  const [, setEndsReached] = useState(0);
  useEffect(() => {
    // `since`: the moment the step was due. Another caller that asked after it
    // has asked for this one too. `atEnd`: an end has come, rather than a
    // recheck of an answer the server gave after its own end.
    const askAgain = (since: number, atEnd: boolean): void => {
      setEndsReached(reached => reached + 1);
      const last = deadlineAsks.get(queryClient);
      if (last !== undefined && last >= since) return;
      deadlineAsks.set(queryClient, Date.now());
      if (atEnd) {
        // Both answers are invalidated in the shared cache, so every caller,
        // one mounted after the end included, refuses them until a newer
        // answer arrives. The refresh replaces any already under way, which
        // may have been asked before the end.
        invalidateCurrentUserAccess(queryClient);
        return;
      }
      void refetch();
      void refetchAnswer();
    };
    const step = nextDeadlineStep({
      ends: knownEnds,
      validUntil,
      answeredAt,
      permissionsAnsweredAt,
      askedAt: deadlineAsks.get(queryClient) ?? null,
      now: Date.now(),
    });
    if (step.kind === "ask-both") {
      askAgain(step.since, true);
      return undefined;
    }
    if (step.kind === "ask-stale") {
      // Only a half not already being asked, so one half landing first does
      // not restart the other.
      const idle = (key: readonly unknown[]): boolean =>
        queryClient.isFetching({ queryKey: key, exact: true }) === 0;
      if (step.list && idle(CURRENT_USER_PERMISSIONS_KEY)) void refetch();
      if (step.answer && idle(capabilitiesKey)) void refetchAnswer();
      return undefined;
    }
    if (step.kind === "none") return undefined;
    const { at, since, atEnd } = step;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      const remaining = at - Date.now();
      // Timers overflow past about 24.8 days, so a later end is waited for in
      // steps rather than asked about early.
      if (remaining > MAX_TIMER_MS) {
        timer = setTimeout(arm, MAX_TIMER_MS);
        return;
      }
      timer = setTimeout(() => askAgain(since, atEnd), Math.max(remaining, 0));
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
    queryClient,
    capabilitiesKey,
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
    action: CollectionAccess
  ): boolean => {
    const entity = capabilities.collections[collectionSlug];
    if (!entity) return false;
    return entity[flagOf(action)];
  };

  /**
   * Whether the user may do what `permission` names. A slug the server's
   * answer names the entity of is answered from it, so a code rule that
   * refuses what a role's permission allows is followed. Until that answer is
   * in hand nothing is known about any entity, so such a slug is refused
   * rather than guessed from the permission list, which cannot see the rules.
   * Once it is, a standard action on a resource the answer does not name is
   * refused, except where that same answer is a super-admin's. Every other slug (a system resource, a
   * plugin's own permission with another action) is the permission list's.
   */
  const can = (permission: string): boolean => {
    const asked = entityPermission(permission);
    if (asked === null) return hasPermission(permission);
    if (!content.hasAnswer) return false;
    return Object.hasOwn(answer.data?.entities ?? {}, asked.resource)
      ? canAccessCollection(asked.resource, asked.action)
      : answer.data?.isSuperAdmin === true;
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
    can,
  };
}
