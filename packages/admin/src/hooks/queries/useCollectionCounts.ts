"use client";

/**
 * Collection Counts Query Hook
 *
 * Derives per-collection entry counts from the dashboard stats API response.
 * Uses useDashboardStats() internally — TanStack Query deduplicates the request.
 *
 * @module hooks/queries/useCollectionCounts
 */

import { useMemo } from "react";

import { useDashboardStats } from "./useDashboardStats";

/**
 * useCollectionCounts Hook
 *
 * Returns a Map of collection slug → entry count, derived from the
 * dashboard stats `collectionCounts` array. No extra API call is made;
 * TanStack Query deduplicates the underlying `useDashboardStats()` request.
 *
 * @returns Object with `counts` Map, `isLoading`, and `error`
 */
export function useCollectionCounts() {
  const { data, isLoading, error } = useDashboardStats();

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    if (!data?.collectionCounts) return map;
    for (const item of data.collectionCounts) {
      map.set(item.slug, item.count);
    }
    return map;
  }, [data?.collectionCounts]);

  return { counts, isLoading, error };
}
