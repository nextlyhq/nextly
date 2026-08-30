/**
 * What a caller is allowed to read, as a value that cannot be misread.
 *
 * This replaces a `Set<string> | undefined` in which `undefined` meant
 * "super-admin, no filter" and an EMPTY SET meant "this caller may read
 * nothing". Consumers checked `size === 0` and treated the empty set as
 * "no filter", so the least-privileged caller was granted the most access.
 *
 * `listEffectivePermissions` returns `[]` for a user with no roles, for a
 * falsy user id, and for ANY thrown error -- on a line whose own comment reads
 * `// fail-closed`. Making the two cases separate constructors is what stops a
 * transient database failure from widening disclosure.
 *
 * @module services/dashboard/readable-resources
 */

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { UserContext } from "../../domains/collections/services/collection-types";

/** A caller's read scope. Construct via {@link allResources} or {@link someResources}. */
export type ReadableResources =
  | { readonly kind: "all" }
  | { readonly kind: "some"; readonly resources: ReadonlySet<string> };

/** Every resource. Super-admins only. */
export function allResources(): ReadableResources {
  return { kind: "all" };
}

/**
 * Exactly the named resources -- and an empty iterable means exactly nothing,
 * which is the whole point of this module.
 */
export function someResources(resources: Iterable<string>): ReadableResources {
  return { kind: "some", resources: new Set(resources) };
}

/** Whether `resource` is readable under `scope`. */
export function canRead(scope: ReadableResources, resource: string): boolean {
  return scope.kind === "all" || scope.resources.has(resource);
}

/** Keep only the items whose resource name is readable under `scope`. */
export function filterByResource<T>(
  scope: ReadableResources,
  items: readonly T[],
  getResource: (item: T) => string
): T[] {
  if (scope.kind === "all") return [...items];
  return items.filter(item => scope.resources.has(getResource(item)));
}

/**
 * Who is asking, in the two shapes an access decision reads.
 *
 * This is the return shape of `readCaller()` (`api/authenticated-read.ts`),
 * declared once here so the dashboard service and the API handler that calls
 * it name the same type instead of each re-deriving it. `authenticatedScope`
 * is present only for an API-key caller: it carries that key's own stamped
 * grant, which must be judged on its own terms rather than falling back to
 * the key's owner's roles.
 */
export interface ReadCaller {
  user: UserContext;
  authenticatedScope?: AuthenticatedScope;
}
