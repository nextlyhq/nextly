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
  /** User's unique identifier */
  id: string;
  /** User's display name */
  name: string;
  /** User's email address */
  email: string;
  /** User's avatar URL (optional) */
  avatar?: string;
  /** User's initials for avatar fallback */
  initials: string;
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
  /** Timestamp when the activity occurred (ISO 8601 format) */
  timestamp: string;
  /** Relative time string (e.g., "2 minutes ago") */
  relativeTime: string;
}

/**
 * Response from the recent activity API endpoint
 */
export interface RecentActivityResponse {
  /** Array of activity entries */
  activities: Activity[];
  /** Total count of activities (for pagination) */
  total: number;
  /** Whether there are more activities to load */
  hasMore: boolean;
}
