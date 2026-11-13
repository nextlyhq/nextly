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
 * the parts plugins add to it declare (`startupReads`) before it is drawn.
 * Each is normally in before the document, so the wait holds nothing; past it
 * the editor is drawn and a late part lands as it would have. Short beside
 * the outline's own 0.4 s, so a slow plugin read never holds an editor that
 * is otherwise ready.
 */
export const EDITOR_REVEAL_HOLD_MS = 250;

/**
 * The longest an editor waits, once its document has arrived, for its claim
 * on the document, which says whether a colleague holds it. Longer than a
 * part's wait: the claim decides whether the fields may be written at all,
 * and an editor drawn writable that a colleague's banner then pushes down
 * and makes read-only is worse than one more moment of its outline. A busy
 * server answers the claim late, which is when this matters.
 */
export const EDITOR_CLAIM_HOLD_MS = 1_000;

/** Where one document's hold stands: when it began, and whether it ended. */
interface RevealHold {
  document: string;
  since: number;
  expired: boolean;
  shown: boolean;
}

/** A hold for `document`, begun now. */
function freshHold(document: string): RevealHold {
  return { document, since: Date.now(), expired: false, shown: false };
}

/**
 * Whether a screen whose own data is in still holds its outline, waiting for
 * the parts that finish it (`waiting`): so the screen is drawn whole, its
 * parts in their places, rather than drawn and then pushed apart as each
 * lands. For `limitMs` (a part's {@link EDITOR_REVEAL_HOLD_MS} unless
 * given) at most from the first render that asked, then never again for this
 * `document`, so a part that answers late after all can never take the
 * screen away once shown. Another document (the same editor moved straight
 * to the next entry) begins a hold of its own.
 */
export function useHeldReveal(
  waiting: boolean,
  limitMs: number = EDITOR_REVEAL_HOLD_MS,
  document = ""
): boolean {
  const [stored, setHold] = useState(() => freshHold(document));
  // Reset while rendering, as React's guide has state follow a prop: the
  // next document's first frame already holds, rather than one frame later.
  let hold = stored;
  if (stored.document !== document) {
    hold = freshHold(document);
    setHold(hold);
  }
  const holding = waiting && !hold.expired && !hold.shown;
  const { since } = hold;
  useEffect(() => {
    const own = (update: Partial<RevealHold>) =>
      setHold(current =>
        current.document === document ? { ...current, ...update } : current
      );
    if (!holding) {
      own({ shown: true });
      return;
    }
    const timer = setTimeout(
      () => own({ expired: true }),
      Math.max(0, since + limitMs - Date.now())
    );
    return () => clearTimeout(timer);
  }, [holding, since, limitMs, document]);
  return holding;
}

/**
 * Whether an editor given its outline (`outlined`) still draws it: while its
 * claim is out, for {@link EDITOR_CLAIM_HOLD_MS} at most, and while its parts'
 * started reads are out, for {@link EDITOR_REVEAL_HOLD_MS} at most. Each wait
 * ends once for `document` (the collection or Single and the document's id);
 * a shown editor is never taken back, but the next document waits afresh.
 */
export function useEditorRevealHold(
  outlined: boolean,
  waiting: { claim: boolean; reads: boolean },
  document = ""
): boolean {
  const forClaim = useHeldReveal(
    outlined && waiting.claim,
    EDITOR_CLAIM_HOLD_MS,
    document
  );
  const forReads = useHeldReveal(
    outlined && waiting.reads,
    EDITOR_REVEAL_HOLD_MS,
    document
  );
  return forClaim || forReads;
}
