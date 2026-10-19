/**
 * How long ago something happened, in words: "just now", "2 minutes ago",
 * "3 days ago". The editor's one phrasing for it, shared by the recovery
 * dialog and the save indicator so the same moment reads the same in both.
 *
 * @module components/features/entries/EntryForm/time-ago
 */

/**
 * Formats a date as a relative time string (e.g., "2 minutes ago").
 * Simple implementation without external dependencies.
 */
export function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();

  // Convert to seconds
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return "just now";
  }

  // Minutes
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return diffMin === 1 ? "1 minute ago" : `${diffMin} minutes ago`;
  }

  // Hours
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }

  // Days
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
  }

  // Weeks (for drafts up to 7 days, this handles edge cases)
  const diffWeeks = Math.floor(diffDays / 7);
  return diffWeeks === 1 ? "1 week ago" : `${diffWeeks} weeks ago`;
}
