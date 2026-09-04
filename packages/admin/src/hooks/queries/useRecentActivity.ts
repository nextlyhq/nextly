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
import {
  describeActivityActor,
  formatRelativeTime,
} from "@admin/lib/dashboard";
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
  /** Null once the actor's account was deleted and their identity erased. */
  userName: string | null;
  /** Null once the actor's account was deleted and their identity erased. */
  userEmail: string | null;
  action: "create" | "update" | "delete";
  collection: string;
  entryId: string | null;
  entryTitle: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  /** When this row's identity was erased; null while the actor exists. */
  identityErasedAt: string | null;
}

interface ActivityLogApiResponse {
  activities: ActivityLogEntry[];
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
    // Delegated rather than mapped here. Whether an entry's author still
    // exists changes the name, the initials and the email it may show, and a
    // second surface deriving those rules independently is how two views of
    // the same deleted actor start disagreeing. One helper owns them.
    user: describeActivityActor(entry),
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
