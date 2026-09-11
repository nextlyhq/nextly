/**
 * What a plugin route is told about the caller BEYOND their identity.
 *
 * A route's `ctx.user` answers who is asking. It cannot answer what they may
 * do, and the two are not the same question for an API key: a key carries its
 * own stamped scope, deliberately narrower than its owner's grants, and a
 * projection down to `{ id, email, name }` loses it — so a read-only key
 * reaches a route with the full reach of whoever minted it.
 *
 * Nothing here decides access. Every branch of that decision already exists —
 * `callerMayPerform` composes the api-key and session halves, and both delegate
 * to the machinery a route-level `requiredPermission` is decided by. This module
 * only carries the facts a decision needs from the boundary that resolved them
 * to the handler that asks.
 *
 * @module plugins/routes/route-caller
 */

import { readCaller } from "../../api/authenticated-read";
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import {
  apiKeyScopeFrom,
  callerMayPerform,
} from "../../auth/authenticated-scope";
import { readAccessCaller } from "../../auth/entity-read-access";
import type { AuthContext } from "../../auth/middleware";
import type { ReadCaller } from "../../services/dashboard/readable-resources";

import type { PluginRouteCaller } from "./route-types";

/**
 * The API key's own stamped grants, or `undefined` for a session.
 *
 * Free to compute — both halves are already on the `AuthContext` — which is why
 * it is resolved eagerly while the role slugs below are not. `actorType` is what
 * every consumer discriminates on, so a session caller carries no scope at all
 * rather than an empty one: an empty `permissions` list on an `apiKey` actor
 * would read as a key that may do nothing, and refuse every check.
 */
export function pluginRouteScope(
  auth: AuthContext
): AuthenticatedScope | undefined {
  return auth.authMethod === "api-key" ? apiKeyScopeFrom(auth) : undefined;
}

/**
 * Build the caller a plugin route handler sees.
 *
 * `can()` resolves its caller through `readCaller` → `readAccessCaller`, the
 * same pair every authenticated read endpoint uses, so a plugin route reaches
 * the same verdict the caller's own request would. Rebuilding the identity here
 * would be a second construction of the object access rules are evaluated
 * against, and `auth/user-context` exists because two such constructions
 * authorize differently.
 *
 * LAZY, and memoized on first use. `readCaller` resolves a SESSION caller's role
 * slugs from the database (`listRoleSlugsForUser`); an API key's arrive already
 * resolved. Nothing caches the route context — `runPluginRoute` builds a fresh
 * one per request — so resolving eagerly would add a permission read to every
 * plugin route call including the many that never ask the question. Built once
 * per request rather than once per `can()` so a handler asking about several
 * collections pays for one resolution.
 */
export function buildPluginRouteCaller(auth: AuthContext): PluginRouteCaller {
  const scope = pluginRouteScope(auth);
  // ONE resolution of the caller per request, shared by both questions asked
  // of it: what the caller may do, and who they are to an enforced read. A
  // second resolution would be a second account read per request, and two
  // answers that could disagree between calls.
  let reader: Promise<ReadCaller> | undefined;
  function identity(): Promise<ReadCaller> {
    reader ??= readCaller(auth);
    return reader;
  }

  return {
    authMethod: auth.authMethod,
    ...(auth.apiKeyId === undefined ? {} : { apiKeyId: auth.apiKeyId }),
    ...(auth.claims === undefined ? {} : { claims: auth.claims }),
    identity,
    async can(action: string, resource: string): Promise<boolean> {
      const caller = readAccessCaller(await identity());
      return callerMayPerform(scope, action, resource, {
        id: caller.userId,
        roles: caller.roles,
      });
    },
  };
}
