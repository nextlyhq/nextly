/**
 * Which role assignments grant anything: the one condition every reader of
 * `user_roles` that decides access applies.
 *
 * An assignment may carry `expires_at`, which is how a site gives a role for a
 * while and has it lapse by itself. One that has passed grants nothing: not a
 * permission, not super-admin authority, not a role in a session's claims and
 * not an API key's grants. Each reader that leaves the condition out hands
 * the lapsed role back on its own path, and the expiry then removes access
 * nowhere, since nothing else runs when an expiry passes. So the condition is
 * stated once, here, and the readers ask it.
 *
 * It is also why a cached answer computed from assignments must end no later
 * than the soonest expiry among them ({@link soonestExpiry}): an expiry is not
 * an event any invalidation hears, so a cache that outlives one serves the
 * lapsed role for the rest of its life.
 */
import { and, eq, gt, isNull, or, type Column, type SQL } from "drizzle-orm";

import { NextlyError } from "../../errors/nextly-error";

/** The columns of `user_roles` the condition reads, on any dialect. */
export interface RoleAssignmentColumns {
  userId: Column;
  expiresAt: Column;
}

/**
 * An assignment is in force at `at` when it has no expiry, or its expiry is
 * still ahead.
 */
export function roleAssignmentInForce(
  userRoles: Pick<RoleAssignmentColumns, "expiresAt">,
  at: Date
): SQL {
  const condition = or(
    isNull(userRoles.expiresAt),
    gt(userRoles.expiresAt, at)
  );
  // `or` of two conditions always yields one; drizzle types the result as
  // possibly undefined because an empty `or` yields nothing. Refused rather
  // than passed on, since a `where` given undefined filters nothing, and a
  // read meant to drop lapsed roles would then return all of them.
  if (condition === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "role-assignment-condition-empty" },
    });
  }
  return condition;
}

/** A user's assignments that are in force at `at`. */
export function userRoleAssignmentsInForce(
  userRoles: RoleAssignmentColumns,
  userId: string,
  at: Date
): SQL {
  const condition = and(
    eq(userRoles.userId, userId),
    roleAssignmentInForce(userRoles, at)
  );
  if (condition === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "role-assignment-condition-empty" },
    });
  }
  return condition;
}

/**
 * The soonest expiry among assignments in force, as epoch milliseconds, or
 * `undefined` when none of them expires. An answer computed from these
 * assignments holds until then and no longer.
 *
 * Accepts the timestamp however a driver hands it back. One that cannot be
 * read counts as already passed, so nothing computed from it is cached, which
 * is the safe direction: the answer is recomputed rather than outliving an
 * expiry nobody could read.
 */
export function soonestExpiry(
  assignments: ReadonlyArray<{
    expiresAt: Date | string | number | null | undefined;
  }>
): number | undefined {
  let soonest: number | undefined;
  for (const { expiresAt } of assignments) {
    if (expiresAt === null || expiresAt === undefined) continue;
    const parsed = new Date(expiresAt).getTime();
    const at = Number.isNaN(parsed) ? 0 : parsed;
    if (soonest === undefined || at < soonest) soonest = at;
  }
  return soonest;
}

/** A user's roles now, and the moment that answer stops holding. */
export interface ResolvedRoles {
  roleIds: Set<string>;
  /** Epoch milliseconds; `undefined` when no assignment involved expires. */
  validUntil: number | undefined;
}

/**
 * When a cache entry filed now must stop being served: after `ttlMs`, or at
 * the soonest expiry it was computed from, whichever comes first.
 */
export function cacheExpiry(
  now: number,
  ttlMs: number,
  validUntil: number | undefined
): number {
  const byTtl = now + ttlMs;
  return validUntil === undefined ? byTtl : Math.min(byTtl, validUntil);
}
