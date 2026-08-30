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
  const allowed = new Set<string>();
  for (const group of authorizationGroups(slugs)) {
    const verdicts = await Promise.all(
      group.map(async slug => ({
        slug,
        allowed: await canReadEntity(slug, caller),
      }))
    );
    for (const verdict of verdicts) {
      if (verdict.allowed) allowed.add(verdict.slug);
    }
  }
  return allowed;
}
