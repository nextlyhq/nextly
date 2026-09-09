/**
 * A scoped API key is authorized on ITS OWN stamped grants, not its owner's.
 *
 * The route middleware authenticates an API-key request and stamps the key's
 * scoped permission list on the dispatcher params. A service-side access re-check
 * (for example the publish/unpublish transition gate, which the route never
 * authorized because it only saw the write as `update`) must judge the key on
 * that stamped scope. Resolving the permission from the key OWNER's `userId`
 * instead — as the ordinary RBAC path does — would let an update-only key issued
 * by a publisher publish, and deny a publish-scoped key issued by a non-publisher.
 * This mirrors `auth/entity-read-access.ts` (`canReadEntity`) for the write side.
 *
 * @module auth/authenticated-scope
 */

import { permissionSlug } from "../schemas/_zod/rbac";
import type {
  CollectionAccessControl,
  SingleAccessControl,
} from "../shared/types/access";

import { codeAccessAllows } from "./entity-read-access";
import type { RequestActorType } from "./request-actor";

/**
 * The authenticated caller's scope, as a service access check needs it.
 *
 * `permissions` are the API key's OWN scoped grants in `{action}-{resource}`
 * form (the same format the route stamps and `canReadEntity` consumes), e.g.
 * `publish-posts`. Only meaningful when `actorType` is `apiKey`; a session or
 * system caller carries none here and resolves its grants the normal way.
 */
export interface AuthenticatedScope {
  actorType: RequestActorType;
  permissions: string[];
  /**
   * The same grants as `permissions`, spelled the way a code-defined access
   * rule reads them — `resource:action`, e.g. `posts:read`.
   *
   * `permissions` above is the STORED spelling (`read-posts`), which is what
   * the coarse grant check tests and what the admin's matrix shows. A rule
   * receives the other one: `AccessFunction` in
   * `collections/fields/types/base` states `resource:action` as its contract,
   * and `listEffectivePermissions` produces it for a session caller. Passing
   * the stored spelling into a rule makes the documented
   * `({ permissions }) => permissions.includes("posts:create")` deny an API key
   * while allowing the identical session caller.
   *
   * Both are projected from one permission row rather than converted from each
   * other; a stored slug may be deliberately custom (`manage-api-keys`) and
   * cannot be decomposed back into an action and a resource.
   *
   * Optional because a scope built from an already-resolved caller carries only
   * what that caller had; `apiKeyWriteAllowed` falls back to `permissions` so
   * such a path is no worse off than before.
   */
  rulePermissions?: string[];
  /**
   * The key's OWN resolved role slugs, when authentication resolved them.
   *
   * A code-defined rule may decide on a role rather than a permission —
   * `create: ({ roles }) => roles.includes("editor")` — and the user object
   * reaching that rule names the key's OWNER. Judging a role-based key on the
   * owner's roles is the same defect as judging it on the owner's permissions,
   * in the direction that DENIES: a key assigned the editor role is refused
   * because the roles it was checked against were never its own.
   *
   * Optional because the read paths that construct a scope from an
   * already-resolved caller carry roles on the user instead; `apiKeyWriteAllowed`
   * prefers this and falls back to that, so neither path loses them.
   */
  roles?: string[];
}

/**
 * Whether a scoped API key's OWN grants authorize `operation` on `resource`.
 *
 * Returns `null` when the caller is not a scoped API key, so the caller falls
 * back to its normal RBAC resolution (the owner's / session's database grants).
 * Returns a boolean for an API key: the stamped scope is authoritative, in both
 * directions — a key without the grant is denied however privileged its owner,
 * and a key with it is allowed however unprivileged.
 */
export function apiKeyScopeAllows(
  scope: AuthenticatedScope | undefined,
  operation: string,
  resource: string
): boolean | null {
  if (scope?.actorType !== "apiKey") return null;
  return scope.permissions.includes(permissionSlug(operation, resource));
}

/** The RBAC surface `apiKeyWriteAllowed` needs — the registered code access. */
interface CodeAccessSource {
  getRegisteredAccess(
    slug: string
  ): CollectionAccessControl | SingleAccessControl | undefined;
}

/**
 * Whether a scoped API key may perform a write `operation` on `resource`.
 *
 * The full mirror of `canReadEntity` for the write side: a scoped key must hold
 * the `{operation}-{resource}` grant AND satisfy the code-defined access rule
 * (`defineCollection/defineSingle({ access: { publish/unpublish/... } })`),
 * evaluated against the KEY's own scope — not the owner's. The permission check
 * alone is not enough: `rbac.checkAccess` (which the API-key path replaces) is
 * also where the code-defined rule runs, so skipping it would let a key with the
 * grant bypass an `access.publish` that returns false.
 *
 * Returns `null` for a non-API-key caller, so the caller falls back to its normal
 * RBAC resolution (which already composes the code-defined rule for that path).
 */
export async function apiKeyWriteAllowed(
  scope: AuthenticatedScope | undefined,
  operation: "create" | "read" | "update" | "delete" | "publish" | "unpublish",
  resource: string,
  user: { id: string; roles?: string[] },
  rbac: CodeAccessSource | undefined
): Promise<boolean | null> {
  if (scope?.actorType !== "apiKey") return null;
  if (!scope.permissions.includes(permissionSlug(operation, resource)))
    return false;
  const codeAccess = rbac?.getRegisteredAccess(resource);
  if (!codeAccess) return true;
  return codeAccessAllows(codeAccess, operation, resource, {
    userId: user.id,
    authMethod: "api-key",
    // The rule-facing spelling when the scope carries it. The coarse check
    // above tests the stored slugs; a rule reads `resource:action`, and handing
    // it the stored form denies every documented permission predicate.
    permissions: scope.rulePermissions ?? scope.permissions,
    // The KEY's roles when it carries them. `user` names the owner, so its
    // roles are the owner's — the very thing this function exists not to judge
    // on. The read paths resolve the key's roles onto the user before calling
    // here, which is why that remains the fallback rather than an error.
    roles: scope.roles ?? user.roles ?? [],
  });
}
