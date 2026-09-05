import { useEffect, useState } from "react";

/**
 * Re-render on a clock, so a value DERIVED from the current time stays true.
 *
 * 🔴 For relative times, and the distinction it fixes is easy to lose. Deriving
 * "2h ago" at render instead of at fetch is only half the repair: a render has
 * to happen for the derivation to run, and a dashboard card that nobody
 * interacts with gets none. An entry fetched as "just now" then keeps that
 * wording for as long as the page is open — the same wrong label as before,
 * arrived at by a different route, and a test that calls `rerender` itself
 * cannot tell the two apart.
 *
 * Returns the current time rather than a counter so the value has a use: a
 * caller can pass it to a formatter, and nothing has to pretend to read a
 * variable it does not want. Callers that only need the re-render may ignore it.
 *
 * ## What it deliberately does not do
 *
 * No pausing while the tab is hidden. One timer per mounted card, at a period
 * measured in tens of seconds, costs less than the code deciding whether to run
 * it — and `visibilitychange` handling would be a second mechanism to keep in
 * step with the first. A hidden tab also gets its timers throttled by the
 * browser already, which is the behaviour that would have been implemented.
 *
 * No alignment to the minute boundary. A label may lag by up to one period,
 * which for a feed of hours-old events is invisible; aligning would mean
 * rescheduling every tick to a computed delay, and the failure mode of getting
 * that arithmetic wrong is a timer that never fires again.
 */
export function useNowTick(periodMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Guarded, because a non-positive period would schedule a timer that fires
    // as fast as the event loop allows and would peg a core for as long as the
    // card is mounted.
    if (!Number.isFinite(periodMs) || periodMs <= 0) return;

    const id = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(id);
  }, [periodMs]);

  return now;
}
