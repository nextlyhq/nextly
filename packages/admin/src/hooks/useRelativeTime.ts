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
  // stop the label advancing at all.
  const iso = date ? date.toISOString() : null;

  const [label, setLabel] = useState<string | null>(() =>
    iso === null ? null : formatRelativeTime(iso)
  );

  useEffect(() => {
    if (iso === null) {
      setLabel(null);
      return;
    }

    // Recomputed on entry as well as on each tick, because the timestamp itself
    // may have changed since the last render -- a refetch lands a new one -- and
    // the value carried in state describes the previous one.
    setLabel(formatRelativeTime(iso));

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setLabel(formatRelativeTime(iso));
          schedule();
        },
        tickInterval(Date.now() - new Date(iso).getTime())
      );
    };
    schedule();

    return () => clearTimeout(timer);
  }, [iso]);

  return label;
}
