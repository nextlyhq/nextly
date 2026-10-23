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
