/**
 * The permission a route requires, when the route cannot spell it in advance.
 *
 * A permission slug names a RESOURCE, and a plugin's own resources can be
 * renamed by the host: `ctx.self.collections[...]` is the P2 remap, and a
 * plugin is told to read its slugs from there rather than hardcode them. So a
 * route gated on a fixed `"create-patterns"` demands a grant that was seeded
 * under whatever the host actually called the collection — a route nobody can
 * call, on the install that renamed it.
 *
 * That is why `plugin-page-builder`'s save route shipped with NO declared
 * permission at all, and said so: "a declared permission has to spell the
 * collection slug, and a host may rename the collection". The reasoning was
 * right and the consequence was a write route that admitted any authenticated
 * caller into a handler that plans and writes.
 *
 * A route may therefore give a FUNCTION of its own resolved names instead of a
 * string. The gate stays where a reviewer reads it — on the route declaration,
 * beside the method and the path — and is correct on an install that renamed
 * the collection.
 *
 * ## The scope composes the slug; the route never spells one
 *
 * `collection(declared, action)` resolves the remap AND composes the slug
 * through the same `permissionSlug` core seeds with. A resolver written as
 * `` `create-${self.collections.patterns}` `` would be a second spelling of a
 * permission — the shape that put an API key's grants in one form and the form
 * every access rule reads in another, and denied a caller who held the grant.
 * One composer means the demanded slug and the seeded slug are one expression.
 *
 * @module plugins/routes/route-permission
 */

import { permissionSlug } from "../../schemas/_zod/rbac";
import type { PluginSelf } from "../self";

/**
 * @public What a route may derive its required permission from.
 *
 * Deliberately narrow. This runs BEFORE the caller is authenticated, so it is
 * handed the plugin's own names and nothing about the request: a resolver that
 * could read the caller would be authorization logic placed before
 * authentication, and a resolver that could reach a service would do work for
 * an unauthenticated request.
 *
 * The two helpers are declared as PROPERTIES holding functions rather than as
 * methods, because destructuring is how they are meant to be used —
 * `({ collection }) => collection(...)`. Method shorthand says "may depend on
 * `this`", which makes that idiomatic call a lint error in every plugin that
 * writes it, and pushes authors toward `scope.collection(...)` to satisfy a
 * constraint neither implementation has.
 */
export interface PluginRoutePermissionScope {
  /** The plugin's own name, as declared. */
  readonly plugin: string;
  /**
   * The permission for `action` on one of the plugin's OWN collections, named
   * by the slug the plugin DECLARED — this resolves the host's rename for you.
   *
   * Falls back to the declared slug when the plugin never contributed it, which
   * is what a plugin gating on somebody else's collection is doing; that is a
   * fixed name and belongs in the string form of `requiredPermission`.
   */
  readonly collection: (declaredSlug: string, action: string) => string;
  /** The same, for one of the plugin's own singles. */
  readonly single: (declaredSlug: string, action: string) => string;
}

/**
 * @public A route's required permission, computed from the plugin's resolved
 * names.
 *
 * Returns `string` rather than `PermissionSlug`: that type narrows to the union
 * of SEEDED slugs when generated types exist, and a computed slug cannot be
 * proven to be one of them. Asserting it would hand the compiler a guarantee
 * this function cannot make. The composer on the scope is what keeps a computed
 * slug well-formed.
 *
 * Must be pure and synchronous. It runs on every request to the route, before
 * anything about the caller is known.
 */
export type PluginRoutePermissionResolver = (
  scope: PluginRoutePermissionScope
) => string;

/** Build the scope a resolver is handed, from the plugin's resolved names. */
export function routePermissionScope(
  self: PluginSelf
): PluginRoutePermissionScope {
  const named = (
    map: Record<string, string>,
    declaredSlug: string,
    action: string
  ): string => permissionSlug(action, map[declaredSlug] ?? declaredSlug);

  return {
    plugin: self.name,
    collection: (declaredSlug, action) =>
      named(self.collections, declaredSlug, action),
    single: (declaredSlug, action) => named(self.singles, declaredSlug, action),
  };
}

/**
 * The slug a route requires, or `undefined` when it requires none.
 *
 * Throws whatever the resolver throws. The dispatcher turns that into a
 * refusal: a route whose gate cannot be computed must not fall through to the
 * ungated path, which is the direction that opens it.
 */
export function resolveRoutePermission(
  required: string | PluginRoutePermissionResolver | undefined,
  self: PluginSelf
): string | undefined {
  if (required === undefined) return undefined;
  if (typeof required !== "function") return required;
  return required(routePermissionScope(self));
}
