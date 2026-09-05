/**
 * Dashboard Activity Types
 *
 * TypeScript types for recent activity feed on the dashboard.
 *
 * @module types/dashboard/activity
 */

/**
 * Activity type indicating the nature of the action
 */
export type ActivityType = "create" | "update" | "delete" | "login" | "logout";

/**
 * Activity category for badge display
 */
export type ActivityCategory = "success" | "info" | "warning" | "destructive";

/**
 * User information for activity feed
 */
export interface ActivityUser {
  /**
   * User's unique identifier.
   *
   * Outlives the account: an activity entry keeps naming the actor that
   * produced it after the account is gone, so the trail stays attributable.
   */
  id: string;
  /**
   * User's display name, or a placeholder naming the deleted account.
   *
   * Always renderable — see `deleted` to tell the two apart.
   */
  name: string;
  /** User's email address; null once the account was deleted and erased. */
  email: string | null;
  /** User's avatar URL (optional) */
  avatar?: string;
  /** User's initials for avatar fallback */
  initials: string;
  /** Whether this actor's account was deleted and their identity erased. */
  deleted: boolean;
}

/**
 * Single activity entry in the dashboard feed
 */
export interface Activity {
  /** Unique activity identifier */
  id: string;
  /** User who performed the action */
  user: ActivityUser;
  /** Type of action performed */
  type: ActivityType;
  /** Human-readable action description (e.g., "created", "updated") */
  action: string;
  /** Target of the action (e.g., "User: John Doe", "Role: Admin") */
  target: string;
  /** Entry title (if available) for styled rendering */
  entryTitle?: string;
  /** Collection label for "in {Collection}" display */
  collectionLabel?: string;
  /** Activity category for badge styling */
  category: ActivityCategory;
  /**
   * When the activity occurred (ISO 8601).
   *
   * 🔴 The only time this entry carries, deliberately. A `relativeTime` string
   * sat beside it, computed once while mapping the response -- so "just now"
   * stayed "just now" for as long as the query's data was reused, which on a
   * dashboard left open is indefinitely. A relative time is a function of when
   * it is READ, so it is derived at render from this, the way every other
   * relative time in the admin already is.
   */
  timestamp: string;
}

/**
 * Response from the recent activity API endpoint
 */
export interface RecentActivityResponse {
  /** Array of activity entries */
  activities: Activity[];
  /**
   * Whether more activity exists beyond this page.
   *
   * There is no total. The server cannot count the feed without authorizing
   * every matching row against its document's read rule, which is unbounded
   * over an audit table -- so it publishes what it can observe exactly rather
   * than a number that would count edits the reader may not see.
   */
  hasMore: boolean;
}
