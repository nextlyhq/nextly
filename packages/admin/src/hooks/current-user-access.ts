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
import type { QueryClient } from "@tanstack/react-query";

import type {
  BulkMutationResult,
  UseBulkMutationReturn,
} from "../types/hooks/bulk-mutation";

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
 * Ask again what the current user may do: after a change to roles, their
 * permissions or someone's role assignments, any of which can change it.
 */
export function invalidateCurrentUserAccess(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    queryKey: CURRENT_USER_PERMISSIONS_KEY,
  });
  void queryClient.invalidateQueries({
    queryKey: CURRENT_USER_CAPABILITIES_KEY,
  });
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
