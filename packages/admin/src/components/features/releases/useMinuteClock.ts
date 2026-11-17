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

/**
 * The time, moved on once a minute while `ticking`. Held still, with no timer,
 * while it is not: a part that shows no time keeps the screen from being drawn
 * again every minute for nothing. It reads the time at once when it starts.
 */
export function useMinuteClock(ticking = true): number {
  const [now, setNow] = useState(() => Date.now());
  const [wasTicking, setWasTicking] = useState(ticking);
  // Started again: the time read now, in the same render, rather than the
  // one held while it stood still.
  if (ticking !== wasTicking) {
    setWasTicking(ticking);
    if (ticking) setNow(Date.now());
  }
  useEffect(() => {
    if (!ticking) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, [ticking]);
  return now;
}
