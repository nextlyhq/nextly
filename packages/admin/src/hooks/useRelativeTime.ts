"use client";

/**
 * A relative-time label that keeps advancing while the page stays open.
 *
 * `formatRelativeTime` reads the clock once, at render. That is correct for a
 * row inside a list the user is scrolling past and wrong for anything that sits
 * still: a dashboard left open in a visible tab takes no further renders, so a
 * card fetched at 9am was still reading "Updated just now" at noon. The label
 * is a FRESHNESS claim, and one that only ever gets more confident as it gets
 * more wrong is worse than no label -- a reader who distrusts a stale number
 * refreshes, and a reader told the number is seconds old does not.
 *
 * The interval is derived from the age rather than fixed, because the label's
 * own resolution changes with it. Under a minute the next change is seconds
 * away; past an hour it is an hour away, and a card ticking every five seconds
 * to re-render the same "3h ago" is work nobody can see. Each bucket is
 * sampled several times over, so a label is never more than a fraction of its
 * own unit behind.
 *
 * Returns `null` for a null date rather than an empty string, so a caller
 * deciding whether to draw the line at all reads one value for "no timestamp"
 * instead of two.
 *
 * The label is DERIVED during render and state holds only a tick count. The
 * obvious shape -- the formatted string in state, updated from the effect --
 * is a frame behind on the render where a timestamp first arrives and on every
 * refetch that lands a new one, because a passive effect flushes after paint.
 *
 * @module hooks/useRelativeTime
 */

import { useEffect, useState } from "react";

import { formatRelativeTime } from "@admin/lib/dashboard";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * How long until this label could next say something different.
 *
 * Sampling FASTER than the bucket it is in, not at the boundary: scheduling for
 * the exact moment the bucket turns puts the whole label's accuracy on one
 * timer firing on time, and a background tab throttles timers to whole seconds
 * or worse. Oversampling costs one string comparison and degrades gently.
 */
function tickInterval(ageMs: number): number {
  if (ageMs < MINUTE) return 5 * SECOND;
  if (ageMs < HOUR) return 30 * SECOND;
  return 5 * MINUTE;
}

export function useRelativeTime(date: Date | null | undefined): string | null {
  // The ISO string, not the Date, as the effect's dependency. A caller that
  // rebuilds an equal `new Date(...)` each render produces a new object
  // identity every time, which would tear down and rebuild the timer on every
  // render and -- because each new timer starts its full interval over -- could
  // stop the label advancing at all. `WidgetGrid` re-renders on every query
  // state change, so this is a live hazard rather than a defensive one.
  const iso = date ? date.toISOString() : null;

  // A TICK COUNTER, not the label. Holding the formatted string in state made
  // the label one paint stale at the two moments that matter: the render where
  // a timestamp first arrives, and each refetch that lands a new one. State is
  // seeded during the first render and updated in an effect, which flushes
  // after paint -- so the card committed the previous label (or none) and
  // corrected it a frame later. Deriving it during render cannot be stale,
  // because there is nothing to keep in step.
  const [, tick] = useState(0);

  useEffect(() => {
    if (iso === null) return;

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          tick(n => n + 1);
          schedule();
        },
        tickInterval(Date.now() - new Date(iso).getTime())
      );
    };
    schedule();

    // Reads `timer` at call time rather than closing over one value, so it
    // always clears the currently-armed timeout -- including one armed by a
    // tick that has already fired.
    return () => clearTimeout(timer);
  }, [iso]);

  return iso === null ? null : formatRelativeTime(iso);
}
