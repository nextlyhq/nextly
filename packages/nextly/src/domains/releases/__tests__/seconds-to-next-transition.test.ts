/**
 * The cache lifetime a scheduled release implies.
 *
 * @module domains/releases/__tests__/seconds-to-next-transition.test
 */
import { describe, expect, it } from "vitest";

import {
  MAX_CACHE_SECONDS,
  secondsToNextTransition,
} from "../seconds-to-next-transition";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const at = (ms: number): Date => new Date(NOW.getTime() + ms);

describe("secondsToNextTransition", () => {
  it("is tag-only when nothing is scheduled", () => {
    // Every read on every site that has never scheduled a release. The cache
    // must behave exactly as it did before releases existed.
    expect(secondsToNextTransition(null, NOW)).toBe(false);
  });

  it("caches until the transition, not for a guessed interval", () => {
    // The whole point: the bound comes from the data. Three hours away means
    // three hours, so the page cannot outlive the release that changes it.
    expect(secondsToNextTransition(at(3 * 60 * 60 * 1000), NOW)).toBe(
      3 * 60 * 60
    );
  });

  it("rounds UP, so a lifetime never ends before the transition", () => {
    // Rounding down would expire the entry a fraction early and re-render a
    // page whose content has not changed yet — harmless but pointless. Rounding
    // up is also what keeps a sub-second interval from flooring to zero, which
    // `unstable_cache` rejects.
    expect(secondsToNextTransition(at(1500), NOW)).toBe(2);
    expect(secondsToNextTransition(at(1), NOW)).toBe(1);
  });

  it("is tag-only for a release that is ALREADY due", () => {
    // Not a small positive number. A due release is applied at READ time, so
    // the page being served is already correct; expiring it repeatedly would
    // re-render the same output until the materialiser catches up.
    expect(secondsToNextTransition(at(-1000), NOW)).toBe(false);
    // Exactly now counts as due, matching `resolveReleaseEffect`, which treats
    // a release scheduled for 09:00 as in effect AT 09:00.
    expect(secondsToNextTransition(NOW, NOW)).toBe(false);
  });

  it("caps a distant release rather than caching for a year", () => {
    // An immortal entry would make tags the sole line of defence against an
    // ordinary edit for as long as the schedule runs.
    expect(secondsToNextTransition(at(400 * 24 * 60 * 60 * 1000), NOW)).toBe(
      MAX_CACHE_SECONDS
    );
  });

  it("does not cap a release inside the ceiling", () => {
    // The control for the cap: a function that always returned the maximum
    // would satisfy the case above while ignoring the schedule entirely.
    const justUnder = MAX_CACHE_SECONDS - 60;
    expect(secondsToNextTransition(at(justUnder * 1000), NOW)).toBe(justUnder);
  });
});
