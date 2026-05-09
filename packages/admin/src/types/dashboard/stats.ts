/**
 * Dashboard Statistics Types
 *
 * TypeScript types for dashboard statistics and metrics display.
 * Mirrors the backend DashboardStatsResponse from DashboardService.
 *
 * @module types/dashboard/stats
 */

/**
 * Content statistics for the hero stats row.
 */
export interface ContentStats {
  totalEntries: number;
  totalMedia: number;
  contentTypes: number;
  recentChanges24h: number;
}

/**
 * Draft vs Published breakdown.
 */
export interface ContentStatus {
  published: number;
  draft: number;
}

/**
 * Per-collection entry count for collection quick-links.
 */
export interface CollectionCount {
  slug: string;
  label: string;
  group: string | null;
  count: number;
}

/**
 * Dashboard statistics data returned from GET /api/dashboard/stats.
 */
export interface DashboardStats {
  content: ContentStats;
  status: ContentStatus;
  collectionCounts: CollectionCount[];
  users: number;
  roles: number;
  permissions: number;
  components: number;
  singles: number;
  apiKeys: number;
}

/**
 * Props for the StatsCard component
 */
export interface StatsCardProps {
  /** Card title (e.g., "Total Users") */
  title: string;
  /** Main value to display (can be number or formatted string) */
  value: string | number;
  /** Percentage change compared to previous period (optional, hidden in compact variant) */
  change?: number;
  /** Trend direction (determines color and icon) */
  trend?: "up" | "down";
  /** Icon to display (from lucide-react) */
  icon?: React.ReactNode;
  /** Display variant: default (large) or compact (small, no trend) */
  variant?: "default" | "compact";
  /** Optional link — when set, renders the card as a clickable link */
  href?: string;
  /** Optional data points for the sparkline trend visualization */
  sparklineData?: number[];
  /** Optional footer content (e.g., "+2 this week") */
  footer?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}
