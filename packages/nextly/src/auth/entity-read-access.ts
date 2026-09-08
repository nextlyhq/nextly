/**
 * Whether a caller may read an entity, decided without a `Request`.
 *
 * `requireCollectionAccess` is the canonical answer, but it reads the incoming
 * request to authenticate, so a dispatcher handler — which only receives the
 * resolved identity — cannot call it. Anything needing the decision after
 * dispatch previously had to approximate it, and the approximations were more
 * permissive than the original.
 *
 * This module holds the decision itself, so both entry points share one rule
 * rather than two that drift.
 *
 * @module auth/entity-read-access
 */

import { container } from "../di/container";
import type { RBACAccessControlService } from "../domains/auth/services/rbac-access-control-service";
import { NextlyError } from "../errors/nextly-error";
import { parsePermissionSlug } from "../plugins/routes/permission-slug";
import type { ReadCaller } from "../services/dashboard/readable-resources";
import type {
  AccessControlContext,
  CollectionAccessControl,
  SingleAccessControl,
} from "../shared/types/access";

/**
 * The resolved identity a read decision needs.
 *
 * `permissions` are the API key's OWN scoped grants in `{action}-{resource}`
 * form. Note the format: `listEffectivePermissions` returns the other one
 * (`{resource}:{action}`), and mixing them silently answers "denied" for every
 * check. Session callers carry an empty list — their grants are resolved from
 * the database instead.
 */
export interface ReadAccessCaller {
  userId: string;
  authMethod: "session" | "api-key";
  permissions: string[];
  /** Role slugs, already normalized (session roles arrive as ids). */
  roles: string[];
}

/**
 * The same caller a read endpoint resolved, in the shape an ENTITY-LEVEL read
 * decision reads.
 *
 * Derived from {@link ReadCaller} rather than rebuilt from the `AuthContext`,
 * and that is the whole point: `readCaller` has already resolved role IDs to
 * slugs, and resolving them a second time is both an extra database read per
 * request and a second chance to resolve them differently. One question, one
 * resolution — the narrower view is derived from the richer one.
 *
 * `authenticatedScope` is present only for an API key, so its presence IS the
 * auth method. Reading `actorType` rather than mere presence keeps that true if
 * a future actor kind starts carrying a scope: a non-key actor must not be
 * judged by {@link canReadEntity}'s api-key branch, which reads `permissions` as
 * the key's own `{action}-{resource}` grants.
 *
 * Here rather than in `api/authenticated-read`, where it began, because a DOMAIN
 * module needs it too — `system:versions` bounds a cross-document read by what
 * its caller may see — and `domains/` must not import from `api/`. Reproducing
 * the conversion there instead would be a second implementation of an access
 * decision, which is the failure this module exists to prevent.
 */
export function readAccessCaller(caller: ReadCaller): ReadAccessCaller {
  const isApiKey = caller.authenticatedScope?.actorType === "apiKey";
  return {
    userId: caller.user.id,
    authMethod: isApiKey ? "api-key" : "session",
    // A session caller carries none here on purpose: its grants are resolved
    // from the database by `checkAccess`. Handing it the key vocabulary would
    // answer "denied" for every check.
    permissions: isApiKey ? (caller.authenticatedScope?.permissions ?? []) : [],
    roles: caller.user.roles ?? [],
  };
}

/** The RBAC service, or undefined before the container is initialized. */
function getRBACService(): RBACAccessControlService | undefined {
  try {
    if (container.has("rbacAccessControlService")) {
      return container.get<RBACAccessControlService>(
        "rbacAccessControlService"
      );
    }
  } catch {
    // DI container not initialized yet — the caller decides how to fall back.
  }
  return undefined;
}

/**
 * Evaluate a code-defined access rule.
 *
 * An absent rule allows: the permission check that precedes this one is what
 * grants access, and a rule that says nothing about an operation does not
 * revoke it. A rule that throws denies, so a broken rule fails closed.
 */
export async function codeAccessAllows(
  codeAccess: CollectionAccessControl | SingleAccessControl,
  operation: "create" | "read" | "update" | "delete" | "publish" | "unpublish",
  resource: string,
  caller: ReadAccessCaller
): Promise<boolean> {
  const operationAccess =
    codeAccess[
      operation as keyof (CollectionAccessControl | SingleAccessControl)
    ];

  if (operationAccess === undefined) return true;
  if (typeof operationAccess === "boolean") return operationAccess;

  // The context carries the CALLER's roles and permissions. For an API key
  // those are the key's own scoped values, not its owner's — which is the
  // whole point of evaluating the rule against the key.
  const ctx: AccessControlContext = {
    user: { id: caller.userId },
    roles: caller.roles,
    permissions: caller.permissions,
    operation,
    collection: resource,
  };

  try {
    return (await operationAccess(ctx)) === true;
  } catch {
    return false;
  }
}

/**
 * Whether this caller may read the entity behind `slug`.
 *
 * Mirrors `requireCollectionAccess` branch for branch, including the parts that
 * are easy to get wrong when reimplementing it:
 *
 * - An API key is judged on its OWN scope. Its owner's grants are irrelevant,
 *   in both directions: a key without `read-{slug}` is denied however
 *   privileged its owner, and a key with it is allowed however unprivileged.
 * - **A super admin does not bypass an API key's scope.** The bypass belongs to
 *   the session path; applying it to keys would make a read-only key issued by
 *   an administrator equivalent to their full account.
 * - Code-defined `access.read` is consulted on both paths.
 *
 * `slug` is entity-generic — `getRegisteredAccess` reads the collection and
 * single maps alike, so a Single resolves its own rules with no branch here.
 */
export async function canReadEntity(
  slug: string,
  caller: ReadAccessCaller
): Promise<boolean> {
  if (!caller.userId || !slug) return false;

  const rbac = getRBACService();

  if (caller.authMethod === "api-key") {
    if (!caller.permissions.includes(`read-${slug}`)) return false;

    const codeAccess = rbac?.getRegisteredAccess(slug);
    if (!codeAccess) return true;
    return codeAccessAllows(codeAccess, "read", slug, caller);
  }

  // Session: `checkAccess` already composes super-admin, code-defined access
  // and the stored grants, so reproducing any of it here would be a second
  // implementation to keep in step.
  if (rbac) {
    return rbac.checkAccess({
      userId: caller.userId,
      operation: "read",
      resource: slug,
    });
  }

  // Before the container is up there is nothing to decide against. Denying is
  // the safe direction; the route-level gate has already run for any real
  // request that reaches a dispatcher handler.
  return false;
}

/**
 * Whether this caller holds one named permission, by its `{action}-{resource}`
 * slug.
 *
 * The general form of {@link canReadEntity}, which asks the same two-branch
 * question about the fixed slug `read-{entity}`. They live side by side so the
 * two branch structures cannot drift apart unnoticed.
 *
 * The session branch delegates WHOLE to `rbac.checkAccess`, which is the same
 * thing `requirePermission` does for a permission-gated route -- so a widget's
 * `requiredPermission` is decided by exactly the machinery that would decide a
 * route declaring the same slug. That includes the super-admin bypass and any
 * registered code-access rule for the named resource, neither of which is
 * reproduced here; a second implementation of either is a second thing to keep
 * in step.
 *
 * Used to decide whether a dashboard widget declaring `requiredPermission` is
 * even mentioned to this caller. That field was previously gated in the admin
 * alone, which is a rendering decision rather than an access one -- a client
 * that simply did not run the check saw every card's existence.
 *
 * Deny-by-default in both directions the way `canReadEntity` is: an empty
 * caller id, an unparseable slug and an unreachable RBAC service each answer
 * false.
 */
export async function callerHoldsPermission(
  slug: string,
  caller: ReadAccessCaller
): Promise<boolean> {
  if (!caller.userId || !slug) return false;

  // An API key is judged on its OWN stamped grant, never on the roles of
  // whoever minted it -- and a super admin does not bypass that, for the same
  // reason spelled out on `canReadEntity`: a read-only key issued by an
  // administrator must not become equivalent to their full account.
  if (caller.authMethod === "api-key") {
    return caller.permissions.includes(slug);
  }

  const rbac = getRBACService();
  if (!rbac) return false;

  const { action, resource } = parsePermissionSlug(slug);
  // A slug with no hyphen parses to an empty resource. `checkAccess` would be
  // asked about a resource that cannot exist, so refuse it here where the
  // reason is legible rather than letting it read as an ordinary denial.
  if (!action || !resource) return false;

  return rbac.checkAccess({
    // `CheckAccessParams` types `operation` as the five CRUD verbs, and a
    // permission slug's action is not bounded by them -- `export-submissions`
    // and `manage-settings` are both real grants in this codebase. The
    // implementation reads it as a plain string throughout (it indexes
    // `codeAccess` by it and forwards it to `hasPermission`), so the value is
    // carried correctly; the type is simply narrower than the function. This
    // is the identical cast `requirePermission` makes for the identical reason,
    // and widening the parameter is a change to the RBAC service's own contract
    // rather than something to settle from a caller.
    operation: action as "create" | "read" | "update" | "delete",
    userId: caller.userId,
    resource,
  });
}

/**
 * How many read decisions may be in flight at once.
 *
 * This bounds the cheap decision that PRECEDES a query rather than the queries
 * themselves, and it exists for a different resource. {@link canReadEntity}
 * resolves a session caller through `isSuperAdmin`, which is a per-user TTL
 * cache: fired concurrently from a cold cache, every call misses before the
 * first one populates it, so a site with a hundred entities opens a hundred
 * simultaneous permission reads to answer one question a hundred times.
 * Grouping them keeps the pool intact and lets the cache do its job.
 */
export const AUTHORIZATION_CONCURRENCY = 8;

/**
 * The order authorization decisions are taken in: one, then bounded groups.
 *
 * The lone first group is not a rounding artefact — it is the warm-up. The
 * shared per-user caches (`isSuperAdmin`, and the role/permission reads behind
 * it) are populated by whichever call resolves first, so letting one finish
 * before the rest fan out converts N cold misses into one miss and N-1 hits.
 * Fanning out immediately is what makes a cold cache expensive.
 *
 * Deliberately NOT a cap on how many entities are authorized. Every candidate
 * still gets a decision, because one skipped without a verdict cannot be safely
 * named as unconsulted (naming it discloses that it exists) nor safely omitted
 * (that is the silent "nothing there" the callers of this exist to prevent).
 * What is bounded here is concurrency, which is the resource that actually
 * breaks.
 */
export function authorizationGroups(
  slugs: readonly string[],
  concurrency: number = AUTHORIZATION_CONCURRENCY
): string[][] {
  // A non-positive step never advances `i`, and a negative one walks it
  // backwards: either spins forever on a non-empty list. Unreachable today —
  // every caller takes the default — which is precisely what makes the guard
  // cheap: it reads two values already in hand and its branch never runs.
  //
  // It THROWS rather than clamping because `concurrency` is a module constant
  // no request can reach, so a bad one is a programming error;
  // `INTERNAL_ERROR` is the honest classification, and the value travels in
  // `logContext` where an operator can see it without it reaching the response.
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw NextlyError.internal({
      logContext: {
        concurrency,
        reason: "authorization concurrency must be a positive integer",
      },
    });
  }
  if (slugs.length === 0) return [];
  const groups: string[][] = [[slugs[0]]];
  const rest = slugs.slice(1);
  for (let i = 0; i < rest.length; i += concurrency) {
    groups.push(rest.slice(i, i + concurrency));
  }
  return groups;
}

/**
 * Which of `slugs` this caller may read, decided one entity at a time.
 *
 * The decision is {@link canReadEntity}'s, taken per entity, because that is
 * the only thing that agrees with what a row read will answer. Deriving the set
 * from permission SLUGS instead — filtering `read-{slug}` or `{slug}:read` —
 * looks equivalent and is not: `checkAccess` resolves a code-defined
 * `access.read` BEFORE it falls back to the stored grants, so a collection
 * authorized purely in code has no permission row to find, and one REFUSED in
 * code still has the row that a slug filter would admit it on.
 *
 * Coarse only in WHAT it decides — whether an entity is in reach at all. The
 * per-row rules of whatever query follows still decide which documents come
 * back.
 */
export async function readableEntities(
  slugs: readonly string[],
  caller: ReadAccessCaller
): Promise<Set<string>> {
  // DEDUPLICATED, because several callers name one entity more than once — a
  // dashboard offering two cards per collection asks about each twice — and a
  // permission decision resolves a session caller through a per-user TTL cache,
  // so the repeat is a second database read for an answer already in hand.
  const distinct = [
    ...new Set(
      slugs.filter(
        (slug): slug is string => typeof slug === "string" && slug !== ""
      )
    ),
  ];

  const allowed = new Set<string>();
  for (const group of authorizationGroups(distinct)) {
    // 🔴 `allSettled`, not `all`. A single rejected decision used to reject the
    // WHOLE calculation, so one unreachable RBAC lookup turned every surface
    // built on this — the dashboard's readable resources, the widget layout,
    // the workspace payload — into an error rather than a narrower answer. A
    // check that threw has told us nothing, and "nothing" must not read as
    // "allowed" either: the slug is denied and the rest of the set still
    // answers. That is the direction `canReadEntity` itself takes when RBAC is
    // unreachable.
    const settled = await Promise.allSettled(
      group.map(slug => canReadEntity(slug, caller))
    );
    group.forEach((slug, index) => {
      const outcome = settled[index];
      if (outcome.status === "fulfilled" && outcome.value) allowed.add(slug);
    });
  }
  return allowed;
}
