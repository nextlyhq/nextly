"use client";

/**
 * How old the dashboard's data is, said once for the page and only when it
 * matters: "Updated N min ago · Refresh" while the oldest answer a card shows
 * is more than five minutes old, and nothing otherwise. Cards draw no time of
 * their own.
 *
 * @module components/features/dashboard/header/Freshness
 */

import type { JSX } from "react";

/** How old the oldest answer may be before the header says so. */
const STALE_AFTER_MS = 5 * 60 * 1000;

export function Freshness({
  oldestAnswerAt,
  now,
  onRefresh,
}: {
  oldestAnswerAt: number | null;
  now: Date;
  onRefresh: () => void;
}): JSX.Element | null {
  if (oldestAnswerAt === null) return null;
  const age = now.getTime() - oldestAnswerAt;
  if (age <= STALE_AFTER_MS) return null;
  return (
    <p
      className="mt-[3px] text-xs text-muted-foreground"
      data-testid="dashboard-freshness"
    >
      Updated {Math.floor(age / 60_000)} min ago ·{" "}
      <button
        type="button"
        onClick={onRefresh}
        className="text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        data-testid="dashboard-refresh"
      >
        Refresh
      </button>
    </p>
  );
}
