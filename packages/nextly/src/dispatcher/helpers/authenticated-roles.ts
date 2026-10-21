import { currentRequestCaller } from "../../auth/caller-scope";

/**
 * The authenticated caller's role slugs, for the handlers that hand roles to
 * access rules.
 *
 * Read from the request caller the route handler set, which carries roles
 * only for the routes that use them. An empty set reads as no roles, so a
 * rule sees the same `undefined` on every route that has none to give.
 * Shared by the collection and single dispatchers.
 */
export function readAuthenticatedRoles(): string[] | undefined {
  const roles = currentRequestCaller()?.roles;
  return roles && roles.length > 0 ? [...roles] : undefined;
}
