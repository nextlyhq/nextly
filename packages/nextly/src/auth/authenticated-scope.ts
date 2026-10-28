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
import { parsePermissionSlug } from "../plugins/routes/permission-slug";
import { permissionSlug } from "../schemas/_zod/rbac";

import type { AccessTarget } from "./access/decide";
import { onceForRequest } from "./access/request-memo";
import { codeAccessAllows } from "./code-access";
import type { RequestActorType } from "./request-actor";
import {
  SESSION_CUTOFF_SECONDS,
  SESSION_STANDING_TTL_MS,
} from "./session/session-standing";

/**
 * One permission the caller holds, as the row it was resolved from.
 *
 * A permission is spelled one way wherever a developer reads or writes it:
 * the STORED slug (`read-posts`), which the database, the admin's permission
 * matrix, a route's `requiredPermission` and every access rule use.
 *
 * The row carries the slug with the action and resource it grants, so every
 * view of a grant is DERIVED from it rather than stored beside it. Storing them side by side is what let a
 * handler narrow one and leave the other holding the grant it had just given
 * up — the field gate reads the rule's list and has no coarse check standing
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
   * resolved to slugs; {@link scopeGrants} says what that costs.
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

/**
 * The scopes authentication made for a full-access key whose maker is an
 * active super-admin, the only scopes that carry super-admin authority, each
 * with the moment that authority lapses.
 *
 * Kept here rather than as a field of the scope, because a scope is public
 * and can be built by hand: a field would be forged as easily as written. A
 * scope built by hand, a narrowed copy and a spread copy are each a different
 * object, so none of them carries the authority, as a narrower scope must not.
 *
 * The authority is the maker's standing when the key was authenticated, so a
 * scope kept past its request (a plugin storing it, a Direct API `actor`
 * reused later) holds it no longer than a session would go on holding a
 * standing that changed: within {@link SESSION_CUTOFF_SECONDS} of the change,
 * and never past the soonest expiry among the maker's roles, where a
 * session's access token ends too. The standing that admitted the key may be
 * up to {@link SESSION_STANDING_TTL_MS} old when the scope is made, so the
 * scope holds the authority for what is left of the cutoff after that. After that it is judged on its grants alone, and the key's next
 * authentication asks again. Timed on a monotonic clock, so setting the wall
 * clock back cannot stretch it once it is made.
 */
const SUPER_ADMIN_SCOPES = new WeakMap<AuthenticatedScope, number>();

const SUPER_ADMIN_SCOPE_LIFETIME_MS =
  SESSION_CUTOFF_SECONDS * 1000 - SESSION_STANDING_TTL_MS;

/**
 * Whether `scope` carries super-admin authority: authentication made it for a
 * full-access key whose maker was an active super-admin, and the bound that
 * authority holds for has not passed.
 */
export function scopeHoldsSuperAdmin(
  scope: AuthenticatedScope | undefined
): boolean {
  if (scope === undefined) return false;
  const lapsesAt = SUPER_ADMIN_SCOPES.get(scope);
  if (lapsesAt === undefined) return false;
  // Asked once per request, so every door one operation passes gives the
  // same answer, even one asked after the bound passed mid-operation. A scope
  // kept for a later request is asked again there, and has lapsed by then.
  return onceForRequest(scope, () => performance.now() < lapsesAt);
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
  /**
   * Whether authentication found the key to carry super-admin authority. Only
   * the internal caller shapes carry it, so a scope built from anything else
   * carries none.
   */
  keyHoldsSuperAdmin?: boolean;
  /**
   * The soonest expiry among the maker's roles (epoch ms), read with the
   * authority, or absent where none expires. The authority ends there.
   */
  keyHoldsSuperAdminUntil?: number;
}): AuthenticatedScope {
  const scope = caller.grants
    ? apiKeyScope(caller.grants, caller.roles)
    : // No rows, so `grants` is left ABSENT rather than empty: absent means
      // "this scope never had them", which `scopeGrants` answers honestly,
      // and an empty array would mean "this key holds nothing" and deny
      // everything.
      freezeScope({
        actorType: "apiKey",
        permissions: [...(caller.permissions ?? [])],
        ...(caller.roles ? { roles: [...caller.roles] } : {}),
      });
  if (caller.keyHoldsSuperAdmin === true) {
    // The role's expiry is wall-clock time, turned into how long is left of it
    // now, so the deadline itself stays on the monotonic clock.
    const lifetime =
      caller.keyHoldsSuperAdminUntil === undefined
        ? SUPER_ADMIN_SCOPE_LIFETIME_MS
        : Math.min(
            SUPER_ADMIN_SCOPE_LIFETIME_MS,
            caller.keyHoldsSuperAdminUntil - Date.now()
          );
    // A role already expired leaves nothing to carry.
    if (lifetime > 0)
      SUPER_ADMIN_SCOPES.set(scope, performance.now() + lifetime);
  }
  return scope;
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
    // No rows to filter, so the slugs are all there is. Narrow those; a rule
    // is handed them as they are, since no row is left to derive more from.
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
 * The rows behind a key's grants, checked against the slugs beside them, so
 * what a rule is handed cannot name a grant `permissions` does not.
 *
 * Every constructor here builds both halves from one list, so they agree by
 * construction and this rejects nothing they produce. What it rejects is a
 * scope assembled by SPREADING one: `{ ...scope, permissions: fewer }` narrows
 * the slugs and keeps every original row, so a rule handed the rows would go
 * on seeing grants the caller has just given up — and it is the one shape the
 * lint boundary cannot refuse, because nothing in the syntax separates it from
 * an ordinary overlay of a record holding a `permissions` field. The
 * disagreement decides an answer here, so it is refused here.
 *
 * `undefined` when the scope carries no rows. A rule is then handed the stored
 * slugs alone, which is what it is handed from the rows too.
 */
export function scopeGrants(
  scope: AuthenticatedScope
): readonly GrantedPermission[] | undefined {
  if (!scope.grants) return undefined;
  const { grants } = scope;
  if (!slugsNameGrants(grants, scope.permissions)) {
    throw NextlyError.internal({
      logContext: {
        reason:
          "authenticated scope carries grants its permissions do not name",
        grants: grants.map(grant => grant.slug),
        permissions: [...scope.permissions],
      },
    });
  }
  return grants;
}

/**
 * Whether `permissions` are exactly the slugs of `grants`, in order.
 *
 * Positional, because both halves come from one `map` over one list. A set
 * comparison would accept a reordering that no constructor can produce, and
 * accepting shapes nothing builds is how a check stops separating anything.
 */
function slugsNameGrants(
  grants: readonly GrantedPermission[],
  permissions: readonly string[]
): boolean {
  return (
    grants.length === permissions.length &&
    grants.every((grant, index) => grant.slug === permissions[index])
  );
}

/**
 * Whether a key's scope, or a reader's caller built from one, carries the
 * grant rows its permission slugs came from, so the key can be judged on
 * those rows. A scope rebuilt from slugs alone, or one whose slugs were
 * narrowed apart from its rows, does not.
 */
export function scopeRowsAgree(scope: {
  readonly grants?: readonly GrantedPermission[];
  readonly permissions: readonly string[];
}): boolean {
  return (
    scope.grants !== undefined &&
    slugsNameGrants(scope.grants, scope.permissions)
  );
}

/**
 * The grants a scope's stored slugs name, for a scope that carries no rows.
 *
 * Only what a decision that could read the slugs would see, for comparing a
 * key judged on its slugs with the decision: never an answer itself. A slug
 * is split on its first hyphen, the inverse of how permission slugs are made.
 */
export function slugGrants(
  permissions: readonly string[]
): GrantedPermission[] {
  return permissions.map(slug => ({ slug, ...parsePermissionSlug(slug) }));
}

/**
 * Whether a scoped API key's OWN grants authorize `operation` on `resource`.
 *
 * Returns `null` when the caller is not a scoped API key, so the caller falls
 * back to its normal RBAC resolution (the owner's / session's database grants).
 * Returns a boolean for an API key: the stamped scope is authoritative, in both
 * directions — a key without the grant is denied however privileged its owner,
 * and a key with it is allowed however unprivileged. The one exception is a
 * scope carrying its maker's super-admin authority, which is allowed whatever
 * its grants say, as every other way in allows it: its grant list may lag a
 * permission added since it was read.
 */
export function apiKeyScopeAllows(
  scope: AuthenticatedScope | undefined,
  operation: string,
  resource: string
): boolean | null {
  if (scope?.actorType !== "apiKey") return null;
  if (scopeHoldsSuperAdmin(scope)) return true;
  return scope.permissions.includes(permissionSlug(operation, resource));
}

/**
 * The RBAC surface `apiKeyWriteAllowed` needs: the registered target, with its
 * code access and whether it is a collection or a Single.
 */
interface CodeAccessSource {
  getRegisteredTarget(slug: string): AccessTarget | undefined;
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
  // A key carrying its maker's super-admin authority holds every permission
  // and passes every rule, as a super-admin's session does.
  if (scopeHoldsSuperAdmin(scope)) return true;
  if (!scope.permissions.includes(permissionSlug(operation, resource)))
    return false;
  const target = rbac?.getRegisteredTarget(resource);
  if (!target) return true;
  return codeAccessAllows(target, operation, {
    userId: user.id,
    authMethod: "api-key",
    // The same slugs the coarse check above compared against, with the rows
    // behind them, checked against those slugs first.
    permissions: [...scope.permissions],
    grants: scopeGrants(scope),
    // The KEY's roles when it carries them. `user` names the owner, so its
    // roles are the owner's — the very thing this function exists not to judge
    // on. The read paths resolve the key's roles onto the user before calling
    // here, which is why that remains the fallback rather than an error.
    roles: [...(scope.roles ?? user.roles ?? [])],
  });
}
