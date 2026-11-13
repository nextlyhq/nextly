"use client";

/**
 * The one timer every loading state in the admin's frame reads.
 *
 * A fast server should never show a loader at all, and a slow one should say
 * so in steps: nothing for the first moment, then the outline of the screen,
 * then a thin moving line under the bar, then one line of text. Each step is a
 * `useDelayedReveal(active, after)`, timed from when the browser arrived at the
 * screen (the wait clock), not from when the asking component mounted. The
 * outline a screen shows while the session is checked and the one it shows
 * while its own data loads are different mounts of the same wait, and timing
 * each from its own mount would hide the outline again for 0.4 s in between.
 *
 * @module components/shared/loading-frame/delayed-reveal
 */

import type { JSX, ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

/** When each part of a wait appears, in milliseconds after the screen was opened. */
export const LOADING_FRAME_TIMES = {
  /** The still outline of the screen, in place of its parts. */
  outline: 400,
  /** The thin moving line under the bar. */
  line: 500,
  /** The one line saying the server is starting. */
  status: 5_000,
} as const;

/**
 * When the screen on show was opened, in `Date.now()` milliseconds, or `null`
 * where nothing provides it (a screen rendered on its own, a test), in which
 * case each wait is timed from its own mount.
 */
export const WaitClockContext = createContext<number | null>(null);

/**
 * Whether a part shown `afterMs` into a wait is due: `false` while `active` is
 * false, and `false` until `afterMs` has passed since the wait clock started.
 * A part asked for after its time is shown from its first render, so it never
 * flashes away and back.
 */
export function useDelayedReveal(active: boolean, afterMs: number): boolean {
  const clock = useContext(WaitClockContext);
  // The mount time stands in only where no clock is provided.
  const [mountedAt] = useState(() => Date.now());
  const due = (clock ?? mountedAt) + afterMs;
  // The due time the timer has reached, so a clock that moves on (a new
  // screen) starts a new wait rather than inheriting the last one's answer.
  const [reached, setReached] = useState<number | null>(() =>
    Date.now() >= due ? due : null
  );

  useEffect(() => {
    if (!active) return;
    const wait = due - Date.now();
    if (wait <= 0) {
      setReached(due);
      return;
    }
    const timer = setTimeout(() => setReached(due), wait);
    return () => clearTimeout(timer);
  }, [active, due]);

  return active && reached === due;
}

/** Renders `children` only once `after` milliseconds of the wait have passed. */
export function DelayedReveal({
  after,
  active = true,
  children,
}: {
  after: number;
  active?: boolean;
  children: ReactNode;
}): JSX.Element | null {
  return useDelayedReveal(active, after) ? <>{children}</> : null;
}

/**
 * The longest an editor waits, once its document has arrived, for the reads
 * that finish it before it is drawn: its claim on the document, which says
 * whether a colleague holds it, and the reads the parts plugins add to it
 * declare (`startupReads`). Each is normally in before the document, so the
 * wait holds nothing; past it the editor is drawn and a late part lands as it
 * would have. Short beside the outline's own 0.4 s, so a slow plugin read
 * never holds an editor that is otherwise ready.
 */
export const EDITOR_REVEAL_HOLD_MS = 250;

/**
 * Whether a screen whose own data is in still holds its outline, waiting for
 * the parts that finish it (`waiting`): so the screen is drawn whole, its
 * parts in their places, rather than drawn and then pushed apart as each
 * lands. For {@link EDITOR_REVEAL_HOLD_MS} at most from the first render
 * that asked, then never again for this mount, so a part that answers late
 * after all can never take the screen away once shown.
 */
export function useHeldReveal(waiting: boolean): boolean {
  const [since] = useState(() => Date.now());
  const [expired, setExpired] = useState(false);
  const [shown, setShown] = useState(false);
  const holding = waiting && !expired && !shown;
  useEffect(() => {
    if (!holding) {
      setShown(true);
      return;
    }
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, since + EDITOR_REVEAL_HOLD_MS - Date.now())
    );
    return () => clearTimeout(timer);
  }, [holding, since]);
  return holding;
}
