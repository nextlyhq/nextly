"use client";

/**
 * F10 PR 5 — useUnreadCount: localStorage-tracked unread badge math.
 *
 * Strategy:
 *   1. Read `lastSeen` ISO timestamp from localStorage on mount.
 *   2. Compute `unread = rows.filter(r => r.startedAt > lastSeen).length`.
 *   3. Subscribe to `visibilitychange` so the journal query refetches
 *      when the admin tab becomes visible (cheap; no constant polling).
 *   4. `markAllSeen()` writes the newest row's startedAt to localStorage
 *      so the badge resets to 0 next render.
 *
 * Why localStorage (not server-side `lastSeen` per user): cross-device
 * sync isn't needed; per-browser state is enough; no schema/API change.
 *
 * @module components/features/notifications/useUnreadCount
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { JOURNAL_QUERY_KEY } from "@admin/hooks/queries/useJournal";
import type { JournalRow } from "@admin/services/journalApi";

export const LAST_SEEN_KEY = "nextly:journal:lastSeen";

export interface UseUnreadCountResult {
  unread: number;
  markAllSeen: () => void;
}

function readLastSeen(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    // Some embedded browsers / privacy modes throw on localStorage
    // access. Treat as "no last-seen recorded" — every row is unread.
    return null;
  }
}

function writeLastSeen(value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_SEEN_KEY, value);
  } catch {
    // Same reasoning as readLastSeen — silently no-op on storage failure.
  }
}

export function useUnreadCount(rows: JournalRow[]): UseUnreadCountResult {
  const queryClient = useQueryClient();
  // Per-tab state: another tab's `markAllSeen()` does NOT propagate
  // here. Spec §12 defers BroadcastChannel; the visibilitychange
  // refresh below is enough for the common single-tab + brief-multitab
  // workflow.
  const [lastSeen, setLastSeen] = useState<string | null>(() => readLastSeen());

  // Re-fetch the journal whenever the admin tab becomes visible. This
  // is the only "live-ish" behaviour — no polling, no SSE — so the
  // badge stays roughly fresh without burning network on idle tabs.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") {
        void queryClient.invalidateQueries({ queryKey: JOURNAL_QUERY_KEY });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [queryClient]);

  const unread = useMemo(() => {
    if (!lastSeen) return rows.length;
    return rows.filter(r => r.startedAt > lastSeen).length;
  }, [rows, lastSeen]);

  const markAllSeen = useCallback((): void => {
    if (rows.length === 0) return;
    // The journal API returns rows newest-first, so rows[0] is the
    // anchor. Writing its startedAt to localStorage makes every
    // already-fetched row "seen" for badge math.
    const newest = rows[0].startedAt;
    writeLastSeen(newest);
    setLastSeen(newest);
  }, [rows]);

  return { unread, markAllSeen };
}
