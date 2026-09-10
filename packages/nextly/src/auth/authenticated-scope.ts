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

import { NextlyError } from "../errors/nextly-error";
import { permissionSlug } from "../schemas/_zod/rbac";
import type {
  CollectionAccessControl,
  SingleAccessControl,
} from "../shared/types/access";

import { codeAccessAllows, getRBACService } from "./entity-read-access";
import type { RequestActorType } from "./request-actor";

/**
 * One permission the caller holds, as the row it was resolved from.
 *
 * A permission is written two ways in this codebase, both deliberately: the
 * STORED slug (`read-posts`), which the database, the admin's permission matrix
 * and a route's `requiredPermission` all use; and the RULE spelling
 * (`posts:read`), which `AccessFunction` documents as what a code-defined
 * access rule receives and which `listEffectivePermissions` produces for a
 * session caller.
 *
 * The row carries what both are made of, so both are DERIVED from it rather
 * than stored beside each other. Storing them side by side is what let a
 * handler narrow one and leave the other holding the grant it had just given
 * up — the field gate reads the rule spelling and has no coarse check standing
 * in front of it, so the narrowing was silently undone.
 *
 * The slug cannot be recomputed from the other two: `RolePermissionService`
 * supports a deliberately custom one (`manage-api-keys`, on action `update`),
 * so it is carried rather than derived.
 */
export interface GrantedPermission {
  /** As stored. What a coarse grant check and `requiredPermission` compare. */
  readonly slug: string;
  readonly action: string;
  readonly resource: string;
}

/**
 * The authenticated caller's scope, as a service access check needs it.
 *
 * Only meaningful when `actorType` is `apiKey`; a session or system caller
 * carries none here and resolves its grants the normal way.
 *
 * Build one with {@link apiKeyScope} and narrow it with {@link narrowScope}.
 * Both freeze what they return, so a scope cannot be edited in place — the two
 * spellings would then disagree, and only one of them guards any given gate.
 */
export interface AuthenticatedScope {
  actorType: RequestActorType;
  /**
   * The caller's grants in the STORED spelling (`read-posts`).
   *
   * DERIVED from {@link grants} when one is present. Kept as its own field
   * because it is what a plugin reads and what every coarse check compares
   * against, and because a scope resolved from an already-authorized caller has
   * the slugs without the rows behind them.
   */
  readonly permissions: readonly string[];
  /**
   * The rows the grants came from — the single source both spellings derive
   * from. Absent on a scope built from a caller whose grants were already
   * resolved to slugs; {@link ruleFacingPermissions} says what that costs.
   */
  readonly grants?: readonly GrantedPermission[];
  /**
   * The key's OWN resolved role slugs, when authentication resolved them.
   *
   * A code-defined rule may decide on a role rather than a permission —
   * `create: ({ roles }) => roles.includes("editor")` — and the user object
   * reaching that rule names the key's OWNER. Judging a role-based key on the
   * owner's roles is the same defect as judging it on the owner's permissions,
   * in the direction that DENIES.
   */
  readonly roles?: readonly string[];
}

/** Freeze a scope and the arrays inside it, so no gate can be desynced. */
function freezeScope(scope: AuthenticatedScope): AuthenticatedScope {
  Object.freeze(scope.permissions);
  if (scope.grants) Object.freeze(scope.grants);
  if (scope.roles) Object.freeze(scope.roles);
  return Object.freeze(scope);
}

/**
 * The scope for a request that arrived on an API key.
 *
 * The one place a key's scope is built, so `permissions` is always the
 * projection of `grants` rather than a second list that agreed with it once.
 */
export function apiKeyScope(
  grants: readonly GrantedPermission[],
  roles?: readonly string[]
): AuthenticatedScope {
  return freezeScope({
    actorType: "apiKey",
    permissions: grants.map(grant => grant.slug),
    grants: [...grants],
    // OMITTED when the caller has none, never `[]`. `apiKeyWriteAllowed` reads
    // `scope.roles ?? user.roles`, and an empty array is not nullish — so
    // fabricating one here would shadow the caller's own roles and deny every
    // rule that asks for one.
    ...(roles ? { roles: [...roles] } : {}),
  });
}

/**
 * The scope for an authenticated caller, from whatever that caller carries.
 *
 * The one place the choice between the two constructions is made, so no call
 * site has to remember which it holds. A caller resolved through
 * `requireAuthentication` carries the rows; one whose grants were already
 * reduced to slugs — a mocked context, a path that stamped them somewhere and
 * read them back — carries only those, and gets a scope that says so rather
 * than an empty one.
 */
export function apiKeyScopeFrom(caller: {
  grants?: readonly GrantedPermission[];
  permissions?: readonly string[];
  // Optional even though `AuthContext` declares it required: a context built
  // by hand — a mock, a replayed request, an endpoint assembling one from
  // parts — omits it, and this runs on the authorization path where throwing
  // turns a missing field into a 500 on every request that shape reaches.
  // An absent role list is the same as an empty one to every reader.
  roles?: readonly string[];
}): AuthenticatedScope {
  if (caller.grants) return apiKeyScope(caller.grants, caller.roles);
  // No rows, so `grants` is left ABSENT rather than empty: absent means "this
  // scope never had them", which `ruleFacingPermissions` answers honestly, and
  // an empty array would mean "this key holds nothing" and deny everything.
  return freezeScope({
    actorType: "apiKey",
    permissions: [...(caller.permissions ?? [])],
    ...(caller.roles ? { roles: [...caller.roles] } : {}),
  });
}

/**
 * A copy of `scope` holding only the grants `keep` accepts.
 *
 * `undefined` in, `undefined` out: a session caller has no scope to narrow.
 *
 * How a route restricts itself further before a sensitive call. Both spellings
 * are re-derived from the surviving rows, so a grant dropped here is dropped at
 * every gate — the collection check, the field rules, and anything added later.
 * Editing `scope.permissions` in place cannot do that and is refused: the array
 * is frozen.
 */
export function narrowScope(
  scope: AuthenticatedScope,
  keep: (grant: GrantedPermission) => boolean
): AuthenticatedScope;
export function narrowScope(
  scope: AuthenticatedScope | undefined,
  keep: (grant: GrantedPermission) => boolean
): AuthenticatedScope | undefined;
// Overloaded rather than widened: a caller that HAS a scope gets one back, and
// only a caller that might not have one has to handle not getting one. Widening
// the single signature made every existing call site — which had already proved
// it held a scope — start compiling against `| undefined`, so accommodating
// session callers would have broken the callers that were never the problem.
export function narrowScope(
  scope: AuthenticatedScope | undefined,
  keep: (grant: GrantedPermission) => boolean
): AuthenticatedScope | undefined {
  // A SESSION caller carries no scope, and reaches the same routes an API key
  // does. Requiring each call site to guard that is how a `!` gets written —
  // and a `!` here is a crash for every signed-in person using the route.
  // There is nothing to narrow and nothing is the honest answer: the caller
  // then passes no scope, and resolves by their own RBAC exactly as before.
  if (!scope) return undefined;
  if (!scope.grants) {
    // No rows to filter, so the slugs are all there is. Narrow those, and leave
    // the rule spelling to `ruleFacingPermissions`, which will read them too.
    return freezeScope({
      ...scope,
      permissions: scope.permissions.filter(slug =>
        keep({ slug, action: "", resource: "" })
      ),
    });
  }
  return apiKeyScope(scope.grants.filter(keep), scope.roles);
}

/**
 * The caller's grants in the spelling a code-defined access rule receives.
 *
 * Derived from the rows, and the rows are checked against the slugs beside them
 * first, so the answer cannot name a grant `permissions` does not.
 *
 * Every constructor here builds both halves from one list, so they agree by
 * construction and this rejects nothing they produce. What it rejects is a
 * scope assembled by SPREADING one: `{ ...scope, permissions: fewer }` narrows
 * the slugs and keeps every original row, so this function would go on
 * authorizing against grants the caller has just given up — and it is the one
 * shape the lint boundary cannot refuse, because nothing in the syntax
 * separates it from an ordinary overlay of a record holding a `permissions`
 * field. The disagreement decides an answer here, so it is refused here.
 *
 * When the scope carries no rows the stored slugs are returned unchanged. That
 * is the honest answer rather than a good one: such a scope never had the parts
 * a rule spelling is composed of, and splitting a slug on its hyphen would
 * invent a resource no permission row names.
 */
export function ruleFacingPermissions(scope: AuthenticatedScope): string[] {
  if (!scope.grants) return [...scope.permissions];
  const { grants } = scope;
  // Positional, because both halves come from one `map` over one list. A set
  // comparison would accept a reordering that no constructor can produce, and
  // accepting shapes nothing builds is how a check stops separating anything.
  const agree =
    grants.length === scope.permissions.length &&
    grants.every((grant, index) => grant.slug === scope.permissions[index]);
  if (!agree) {
    throw NextlyError.internal({
      logContext: {
        reason:
          "authenticated scope carries grants its permissions do not name",
        grants: grants.map(grant => grant.slug),
        permissions: [...scope.permissions],
      },
    });
  }
  return grants.map(grant => `${grant.resource}:${grant.action}`);
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
    // The rule-facing spelling, derived from the same rows the coarse check
    // above compared against. A rule reads `resource:action`, and handing it
    // the stored form denies every documented permission predicate.
    permissions: ruleFacingPermissions(scope),
    // The KEY's roles when it carries them. `user` names the owner, so its
    // roles are the owner's — the very thing this function exists not to judge
    // on. The read paths resolve the key's roles onto the user before calling
    // here, which is why that remains the fallback rather than an error.
    roles: [...(scope.roles ?? user.roles ?? [])],
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
