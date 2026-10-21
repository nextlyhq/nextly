"use client";

/**
 * The current time, moved on once a minute.
 *
 * Shared by the release screens that say something about "now": the list's
 * relative times ("in 3 minutes") and the calendar's today, which must move
 * to the next day for a page left open across midnight.
 *
 * @module components/features/releases/useMinuteClock
 */
import { useEffect, useState } from "react";

/** How often the clock moves on. */
const CLOCK_TICK_MS = 60_000;

export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
