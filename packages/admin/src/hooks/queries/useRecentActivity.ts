/**
 * Recent Activity Query Hook
 *
 * TanStack Query hook for fetching recent activity feed from the
 * GET /api/dashboard/activity endpoint.
 *
 * @module hooks/queries/useRecentActivity
 */

import type { UseQueryResult } from "@tanstack/react-query";
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
// A widget answer's rows
// ─────────────────────────────────────────────────────────────────────────────

const ACTIONS: ReadonlySet<string> = new Set(["create", "update", "delete"]);
const ACTOR_TYPES: ReadonlySet<string> = new Set(["user", "apiKey", "system"]);
const SUBJECT_KINDS: ReadonlySet<string> = new Set([
  "collection",
  "single",
  "settings",
]);

/** `value` when it is a string, or `null`, so a driver's number or an absent key cannot pass. */
function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** `value` when it is one of `allowed`, so an unknown spelling is read as absent. */
function oneOf<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>
): T | undefined {
  return typeof value === "string" && allowed.has(value)
    ? (value as T)
    : undefined;
}

/**
 * One row of the Recent activity card's answer, from `system:activity`, as the
 * card draws it, or `undefined` for a row this build cannot read.
 *
 * Read at the boundary, field by field, because a widget answer is JSON and its
 * type says nothing at runtime. Then drawn through `mapEntry`, the mapping the
 * activity endpoint's answer goes through, so the card and this hook cannot
 * come to head one row two ways.
 */
export function activityFromRow(
  row: Record<string, unknown>
): Activity | undefined {
  const id = textOrNull(row.id);
  const userId = textOrNull(row.userId);
  const collection = textOrNull(row.collection);
  const createdAt = textOrNull(row.createdAt);
  const action = oneOf<ActivityLogEntry["action"]>(row.action, ACTIONS);
  if (!id || !userId || !collection || !createdAt || !action) return undefined;
  const actorType = oneOf<NonNullable<ActivityLogEntry["actorType"]>>(
    row.actorType,
    ACTOR_TYPES
  );
  const subjectKind = oneOf<NonNullable<ActivityLogEntry["subjectKind"]>>(
    row.subjectKind,
    SUBJECT_KINDS
  );
  return mapEntry({
    id,
    userId,
    action,
    collection,
    createdAt,
    ...(actorType ? { actorType } : {}),
    userName: textOrNull(row.userName),
    userEmail: textOrNull(row.userEmail),
    entryId: textOrNull(row.entryId),
    entryTitle: textOrNull(row.entryTitle),
    subjectKind: subjectKind ?? null,
    metadata: null,
    identityErasedAt: textOrNull(row.identityErasedAt),
    ...(typeof row.count === "number" ? { count: row.count } : {}),
    ...(typeof row.countAtLeast === "boolean"
      ? { countAtLeast: row.countAtLeast }
      : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useRecentActivity Hook
 *
 * Fetches and caches recent activity feed using TanStack Query.
 *
 * @deprecated The dashboard's Recent activity card is answered by the
 * `system:activity` widget source through the dashboard's batch; this hook
 * reads the older `GET /api/dashboard/activity`, kept for compatibility.
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
export function useRecentActivity(
  limit = 10
): UseQueryResult<RecentActivityResponse, Error> {
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
