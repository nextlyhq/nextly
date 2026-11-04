"use client";

/**
 * The signed-in user's id, for a surface that keeps something per user, such
 * as a plugin's own preferences on a browser two people share.
 *
 * Derived from {@link useDashboardUser}, so it reads the same `["auth","me"]`
 * query the admin's chrome already holds: no request of its own, and no second
 * answer to who is signed in. `null` while that answer is not known yet, when
 * no one is signed in, and when the read failed: a caller keeps nothing for
 * nobody rather than for a guess.
 *
 * @module hooks/useCurrentUserId
 */
import { useDashboardUser } from "./useDashboardUser";

export function useCurrentUserId(): string | null {
  // The query keeps its last data beside a failed read, so a failure answers
  // null rather than the user who was signed in before it.
  const { user, error } = useDashboardUser();
  return error === null ? (user?.id ?? null) : null;
}
