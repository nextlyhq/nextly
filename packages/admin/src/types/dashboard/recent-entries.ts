/**
 * Dashboard Recent Entries Types
 *
 * TypeScript types for the recent entries widget on the dashboard.
 * Mirrors the backend RecentEntriesResponse from DashboardService.
 *
 * @module types/dashboard/recent-entries
 */

/**
 * A recently edited entry across any collection.
 */
export interface RecentEntry {
  /** Entry unique identifier */
  id: string;
  /** Entry title (from useAsTitle field, or fallback to ID) */
  title: string;
  /** Collection slug the entry belongs to */
  collectionSlug: string;
  /** Human-readable collection label */
  collectionLabel: string;
  /** Entry publication status */
  status: "published" | "draft" | "none";
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

/**
 * Response from GET /api/dashboard/recent-entries.
 */
export interface RecentEntriesResponse {
  /** Array of recently edited entries */
  entries: RecentEntry[];
}
