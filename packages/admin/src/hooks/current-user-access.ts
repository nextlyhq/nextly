/**
 * The cache keys of what the signed-in user may do, and how to ask again.
 *
 * Kept apart from `useCurrentUserPermissions` so the mutations that change
 * roles, permissions or role assignments can refresh it without importing the
 * hook, whose router import would pull the whole routing table into every
 * query module.
 *
 * @module hooks/current-user-access
 */
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import type {
  BulkMutationResult,
  UseBulkMutationReturn,
} from "../types/hooks/bulk-mutation";
import type { CapabilitiesResponse } from "../types/permissions";

/** The query key of the user's permission slugs. */
export const CURRENT_USER_PERMISSIONS_KEY = ["currentUserPermissions"] as const;

/**
 * The query key of the server's answer about collections and Singles, in
 * every content language: a prefix, so an invalidation by it reaches each.
 */
export const CURRENT_USER_CAPABILITIES_KEY = [
  "currentUserCapabilities",
] as const;

/**
 * The query key of the answer in one content language, `undefined` being the
 * app's default. A rule can answer by language, so each is its own answer.
 */
export function currentUserCapabilitiesKey(
  locale: string | undefined
): readonly unknown[] {
  return [...CURRENT_USER_CAPABILITIES_KEY, locale ?? null];
}

/**
 * Whether a capabilities answer already held names the slug a Single.
 *
 * Whether an entity is a collection or a Single is the same in every content
 * language, so the answer of any language says. With no answer held, nothing
 * says the slug is a Single, and it is not taken for one.
 */
function isKnownSingle(queryClient: QueryClient, slug: string): boolean {
  return queryClient
    .getQueriesData<CapabilitiesResponse>({
      queryKey: CURRENT_USER_CAPABILITIES_KEY,
    })
    .some(([, answer]) => answer?.entities[slug]?.kind === "single");
}

/**
 * {@link isKnownSingle}, kept current: the caller renders again when a
 * capabilities answer arrives or changes. A read that asked before the answer
 * was in can then be asked again with what it says.
 */
export function useIsKnownSingle(slug: string): boolean {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient]
  );
  const read = () => isKnownSingle(queryClient, slug);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Ask again what the current user may do: after a change to roles, their
 * permissions or someone's role assignments, any of which can change it.
 */
export function invalidateCurrentUserAccess(queryClient: QueryClient): void {
  askAccessAgain(queryClient, CURRENT_USER_PERMISSIONS_KEY);
  askAccessAgain(queryClient, CURRENT_USER_CAPABILITIES_KEY);
}

/**
 * Ask an access answer again after a change. A request already under way was
 * asked before the change, so it is cancelled first: invalidating alone
 * would let it stand in for the refresh when no answer is cached yet, and its
 * answer from before the change would then land looking current.
 */
export function askAccessAgain(
  queryClient: QueryClient,
  queryKey: readonly unknown[]
): void {
  void queryClient
    .cancelQueries({ queryKey })
    .then(() => queryClient.invalidateQueries({ queryKey }));
}

/**
 * A bulk edit that asks again what the user may do once a run has changed
 * anything that can: by default any item that succeeded, or what `changes`
 * says. The refresh rides on the run itself rather than on a default
 * callback, which a caller's own `onComplete` replaces.
 */
export function withAccessRefresh<TId, TData, TError, TContext>(
  bulk: UseBulkMutationReturn<TId, TData, TError, TContext>,
  queryClient: QueryClient,
  changes: (result: BulkMutationResult<TData, TError>) => boolean = result =>
    result.succeeded > 0
): UseBulkMutationReturn<TId, TData, TError, TContext> {
  const afterRun = (
    result: BulkMutationResult<TData, TError>
  ): BulkMutationResult<TData, TError> => {
    if (changes(result)) invalidateCurrentUserAccess(queryClient);
    return result;
  };
  // A caller's callback that throws rejects the run after its edits have
  // landed, so the refresh is made on that path too, with nothing to say
  // whether one of them could have changed access.
  const afterFailure = (error: unknown): never => {
    invalidateCurrentUserAccess(queryClient);
    throw error;
  };
  return {
    ...bulk,
    mutate: (ids, context, options) =>
      bulk.mutate(ids, context, options).then(afterRun, afterFailure),
    mutateAsync: (ids, context, options) =>
      bulk.mutateAsync(ids, context, options).then(afterRun, afterFailure),
  };
}
