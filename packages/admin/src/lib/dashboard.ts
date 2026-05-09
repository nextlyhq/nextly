/**
 * Dashboard utility functions
 *
 * @module lib/dashboard
 */

import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";

/**
 * Converts an ISO timestamp to a human-readable relative time string.
 *
 * @param isoTimestamp - ISO 8601 date string
 * @returns Relative time string (e.g. "just now", "5m ago", "3h ago", "2d ago", "Mar 1")
 */
export function formatRelativeTime(isoTimestamp: string): string {
  const now = Date.now();
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
