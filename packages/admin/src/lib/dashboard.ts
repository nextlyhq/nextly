/**
 * Dashboard utility functions
 *
 * @module lib/dashboard
 */

import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { getInitials } from "@admin/lib/utils";
import type { ActivityUser } from "@admin/types/dashboard/activity";

/** Avatar fallback for an actor whose identity was erased. */
const DELETED_ACTOR_INITIALS = "?";

/** Avatar initials for a key, which has no name to take them from. */
const API_KEY_ACTOR_INITIALS = "AK";

/**
 * How much of the actor's id is shown beside "deleted user".
 *
 * Telling two deleted actors apart is the whole reason the id survives the
 * account, so the label has to be long enough that it actually does. Four hex
 * characters is only 65,536 labels — about a 1.9% chance of a collision among
 * 50 deleted actors, which would silently merge two people's histories in the
 * feed. Eight puts that below one in a million.
 */
const DELETED_ACTOR_ID_LENGTH = 8;

/**
 * The actor to display for an activity entry, whether or not their account
 * still exists.
 *
 * The single place that decides how an erased actor reads, so a second
 * activity surface renders them the same way by calling this rather than by
 * reimplementing the rule.
 *
 * A deleted account's name and email are erased, but the entry still has to
 * name someone — an audit line reading "published Q3 Report" with no actor is
 * not an audit line. The opaque id fills that role: "[deleted user · a1b2]"
 * says an account did this, says which one relative to the other entries, and
 * says nothing about who they were.
 */
export function describeActivityActor(entry: {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  identityErasedAt: string | null;
  /**
   * What KIND of caller `userId` refers to.
   *
   * Optional because it arrives over HTTP: a server older than this admin does
   * not send it, and an absent field must read as the kind that was the only
   * recordable one before it existed rather than as an unknown.
   */
  actorType?: string | null;
}): ActivityUser {
  // An API key has no account, so it has no name, no email and no erasure — the
  // three things every branch below reads. Without this it falls through to the
  // live-actor case and renders a BLANK name, which is a less attributable feed
  // than the one before keys were recorded at all.
  if (entry.actorType === "apiKey") {
    return {
      id: entry.userId,
      // The key's own id, shortened the way a deleted actor's is, so two keys
      // are told apart rather than both reading "API key".
      name: `API key · ${entry.userId.slice(0, DELETED_ACTOR_ID_LENGTH)}`,
      email: null,
      initials: API_KEY_ACTOR_INITIALS,
      deleted: false,
    };
  }

  // The stamp is the authority: a live actor can legitimately have no name
  // (the writer falls back through name → firstName → email), and calling
  // that person deleted would be worse than showing an empty label.
  const deleted = entry.identityErasedAt !== null;

  if (!deleted) {
    return {
      id: entry.userId,
      name: entry.userName ?? "",
      email: entry.userEmail,
      initials: getInitials(entry.userName),
      deleted: false,
    };
  }

  return {
    id: entry.userId,
    name: `[deleted user · ${entry.userId.slice(0, DELETED_ACTOR_ID_LENGTH)}]`,
    email: null,
    initials: DELETED_ACTOR_INITIALS,
    deleted: true,
  };
}

/**
 * Converts an ISO timestamp to a human-readable relative time string.
 *
 * @param isoTimestamp - ISO 8601 date string
 * @param at - The instant to measure FROM, in epoch milliseconds. Defaults to
 *   now, which is what every caller reading a one-off label wants. A caller
 *   re-rendering on a clock passes the instant that caused the render, so the
 *   label and the tick behind it cannot disagree -- and a test can state the
 *   moment it is asking about instead of stubbing the global clock.
 * @returns Relative time string (e.g. "just now", "5m ago", "3h ago", "2d ago", "Mar 1")
 */
export function formatRelativeTime(isoTimestamp: string, at?: number): string {
  const now = at ?? Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDateWithAdminTimezone(
    isoTimestamp,
    {
      locale: "en",
      month: "short",
      day: "numeric",
    },
    ""
  );
}
