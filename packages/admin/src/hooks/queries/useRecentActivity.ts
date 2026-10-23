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
import { describeActivityActor } from "@admin/lib/dashboard";
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
  /**
   * What KIND of caller `userId` refers to.
   *
   * Optional because a server older than this admin does not send it. The
   * display helper decides what an absent value means, so this surface and any
   * other reading the feed cannot disagree about it.
   */
  actorType?: "user" | "apiKey" | "system";
  userId: string;
  /** Null once the actor's account was deleted and their identity erased. */
  userName: string | null;
  /** Null once the actor's account was deleted and their identity erased. */
  userEmail: string | null;
  action: "create" | "update" | "delete";
  collection: string;
  entryId: string | null;
  entryTitle: string | null;
  /**
   * What the row is about. Optional because a server older than this admin
   * does not send it; absent or null, the row is a collection's.
   */
  subjectKind?: "collection" | "single" | "settings" | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  /**
   * How many saves the row stands for. Optional because a server older than
   * this admin does not send it, and every row it sends is one save.
   */
  count?: number;
  /** Whether `count` is a floor. Absent from an older server. */
  countAtLeast?: boolean;
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
  const entryTitle = entry.entryTitle ?? undefined;
  // A Single's row is headed by the Single's label alone. Its `collection` is
  // the Single's slug, not a collection, so showing it as the collection the
  // entry belongs to would print a slug no reader chose and name a collection
  // that does not exist.
  if (entry.subjectKind === "single") {
    return {
      ...shared(entry),
      target: entryTitle ?? "a Single",
      entryTitle,
    };
  }
  const collectionLabel = entry.collection;
  const target = entryTitle
    ? `${entryTitle} in ${collectionLabel}`
    : collectionLabel;

  return {
    ...shared(entry),
    target,
    entryTitle,
    collectionLabel,
  };
}

/** What every row carries whatever it is about: who, what they did, when. */
function shared(
  entry: ActivityLogEntry
): Omit<Activity, "target" | "entryTitle" | "collectionLabel"> {
  return {
    id: entry.id,
    // Delegated rather than mapped here. Whether an entry's author still
    // exists changes the name, the initials and the email it may show, and a
    // second surface deriving those rules independently is how two views of
    // the same deleted actor start disagreeing. One helper owns them.
    user: describeActivityActor(entry),
    type: entry.action,
    action: ACTION_LABELS[entry.action] ?? entry.action,
    category: ACTION_CATEGORIES[entry.action] ?? "info",
    timestamp: entry.createdAt,
    count: entry.count ?? 1,
    countAtLeast: entry.countAtLeast === true,
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
