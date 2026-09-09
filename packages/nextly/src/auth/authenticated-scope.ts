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

import { codeAccessAllows, getRBACService } from "./entity-read-access";
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
    permissions: scope.permissions,
    // The KEY's roles when it carries them. `user` names the owner, so its
    // roles are the owner's — the very thing this function exists not to judge
    // on. The read paths resolve the key's roles onto the user before calling
    // here, which is why that remains the fallback rather than an error.
    roles: scope.roles ?? user.roles ?? [],
  });
}

/**
 * Whether this caller may perform `action` on `resource`, whichever way they
 * authenticated.
 *
 * The two branches of the decision, composed: a scoped API key is judged on its
 * OWN stamped grants by {@link apiKeyWriteAllowed} (permission grant AND the
 * code-defined access rule), and everyone else falls through to
 * `rbac.checkAccess`, which is where the super-admin bypass, the code-defined
 * rule and the stored grants already live. Neither half is reproduced here.
 *
 * That asymmetry is the rule, not an omission: a super admin does NOT bypass an
 * API key's scope, for the reason spelled out on `canReadEntity` — a read-only
 * key issued by an administrator must not become equivalent to their full
 * account. The bypass belongs to the session path, and reaching it through
 * `checkAccess` is what keeps that true without restating it.
 *
 * `action` is a plain string rather than the CRUD union because a permission
 * slug's action is not bounded by those four — `export-submissions` and
 * `manage-settings` are both real grants here. `checkAccess` reads it as a
 * string throughout (it indexes `codeAccess` by it and forwards it to
 * `hasPermission`), so the value travels correctly; the type is simply narrower
 * than the implementation. This is the identical cast `requirePermission` and
 * `callerHoldsPermission` make, for the identical reason.
 *
 * Deny-by-default: an unreachable RBAC service answers false rather than
 * falling through to a permissive default.
 *
 * Distinct from `callerHoldsPermission`, which answers the same question for a
 * WIDGET's declared slug and whose api-key branch is the bare permission check.
 * This one also evaluates the code-defined rule against the key's scope, so its
 * answer agrees with what a write on the same resource will actually enforce —
 * which is the property a caller gating a verb on it needs.
 */
export async function callerMayPerform(
  scope: AuthenticatedScope | undefined,
  action: string,
  resource: string,
  user: { id: string; roles?: string[] }
): Promise<boolean> {
  if (!user.id || !action || !resource) return false;

  const rbac = getRBACService();

  const byKey = await apiKeyWriteAllowed(
    scope,
    action as "create" | "read" | "update" | "delete",
    resource,
    user,
    rbac
  );
  if (byKey !== null) return byKey;

  if (!rbac) return false;
  return rbac.checkAccess({
    userId: user.id,
    operation: action as "create" | "read" | "update" | "delete",
    resource,
  });
}
