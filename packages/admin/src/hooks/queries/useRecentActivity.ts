/**
 * Recent Activity Query Hook
 *
 * TanStack Query hook for fetching recent activity feed from the
 * GET /api/dashboard/activity endpoint.
 *
 * @module hooks/queries/useRecentActivity
 */

import { useQuery } from "@tanstack/react-query";

import { protectedApi } from "@admin/lib/api/protectedApi";
import { formatRelativeTime } from "@admin/lib/dashboard";
import { getInitials } from "@admin/lib/utils";
import type {
  Activity,
  ActivityCategory,
  RecentActivityResponse,
} from "@admin/types/dashboard/activity";

// ─────────────────────────────────────────────────────────────────────────────
// Backend response types (matches ActivityLogService output)
// ─────────────────────────────────────────────────────────────────────────────

interface ActivityLogEntry {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  action: "create" | "update" | "delete";
  collection: string;
  entryId: string | null;
  entryTitle: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ActivityLogApiResponse {
  activities: ActivityLogEntry[];
  total: number;
  hasMore: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transformation helpers
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  create: "created",
  update: "updated",
  delete: "deleted",
};

const ACTION_CATEGORIES: Record<string, ActivityCategory> = {
  create: "success",
  update: "info",
  delete: "destructive",
};

function mapEntry(entry: ActivityLogEntry): Activity {
  const collectionLabel = entry.collection;
  const entryTitle = entry.entryTitle ?? undefined;
  const target = entryTitle
    ? `${entryTitle} in ${collectionLabel}`
    : collectionLabel;

  return {
    id: entry.id,
    user: {
      id: entry.userId,
      name: entry.userName,
      email: entry.userEmail,
      initials: getInitials(entry.userName),
    },
    type: entry.action,
    action: ACTION_LABELS[entry.action] ?? entry.action,
    target,
    entryTitle,
    collectionLabel,
    category: ACTION_CATEGORIES[entry.action] ?? "info",
    timestamp: entry.createdAt,
    relativeTime: formatRelativeTime(entry.createdAt),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useRecentActivity Hook
 *
 * Fetches and caches recent activity feed using TanStack Query.
 *
 * **Query Configuration**:
 * - `queryKey`: `["dashboard", "activity", limit]`
 * - `staleTime`: 5 minutes
 * - `gcTime`: 10 minutes
 * - `retry`: 2
 * - `refetchOnWindowFocus`: true
 *
 * @param limit - Maximum number of activities to fetch (default: 10)
 * @returns TanStack Query result with recent activity data
 */
export function useRecentActivity(limit = 10) {
  return useQuery<RecentActivityResponse, Error>({
    queryKey: ["dashboard", "activity", limit],
    queryFn: async () => {
      const raw = await protectedApi.get<ActivityLogApiResponse>(
        `/dashboard/activity?limit=${limit}`
      );
      return {
        activities: raw.activities.map(mapEntry),
        total: raw.total,
        hasMore: raw.hasMore,
      };
    },
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}
