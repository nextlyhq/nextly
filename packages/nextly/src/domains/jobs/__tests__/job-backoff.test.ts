/**
 * When a failed attempt runs again, and when it stops running.
 *
 * @module domains/jobs/__tests__/job-backoff.test
 */
import { describe, expect, it } from "vitest";

import { BACKOFF_CAP_MS, BACKOFF_BASE_MS, nextAttempt } from "../job-backoff";

const NOW = new Date("2026-01-01T00:00:00.000Z");
/** No jitter, so the exponential term is observable on its own. */
const noJitter = () => 1;

describe("nextAttempt", () => {
  it("backs off exponentially while the budget lasts", () => {
    const delay = (attemptCount: number): number => {
      const result = nextAttempt({
        attemptCount,
        maxAttempts: 10,
        now: NOW,
        random: noJitter,
      });
      if (result.outcome !== "retry") throw new Error("expected a retry");
      return result.at.getTime() - NOW.getTime();
    };
    expect(delay(1)).toBe(BACKOFF_BASE_MS);
    expect(delay(2)).toBe(BACKOFF_BASE_MS * 2);
    expect(delay(3)).toBe(BACKOFF_BASE_MS * 4);
  });

  it("gives up once the budget is spent", () => {
    expect(
      nextAttempt({
        attemptCount: 3,
        maxAttempts: 3,
        now: NOW,
        random: noJitter,
      })
    ).toEqual({ outcome: "failed" });
  });

  it("still retries on the attempt BEFORE the last", () => {
    // The control for the case above. An implementation that always failed
    // would satisfy it while making every job single-shot.
    expect(
      nextAttempt({
        attemptCount: 2,
        maxAttempts: 3,
        now: NOW,
        random: noJitter,
      }).outcome
    ).toBe("retry");
  });

  it("caps the delay instead of doubling without limit", () => {
    // 2^40 milliseconds is longer than the universe has been running. Without a
    // cap a job with a generous budget schedules its later attempts past any
    // date the system can act on, which is indistinguishable from dropping it.
    const result = nextAttempt({
      attemptCount: 40,
      maxAttempts: 50,
      now: NOW,
      random: noJitter,
    });
    if (result.outcome !== "retry") throw new Error("expected a retry");
    expect(result.at.getTime() - NOW.getTime()).toBe(BACKOFF_CAP_MS);
  });

  it("spreads simultaneous failures instead of retrying them in lockstep", () => {
    // The reason jitter is here rather than a plain doubling: when one
    // downstream receiver goes down, EVERY delivery to it fails in the same
    // pass. Without jitter all of them retry at the same instant, and keep
    // doing so, so the recovering receiver is hit by the whole backlog at once
    // — repeatedly. Webhooks is this runner's first consumer, so that is the
    // ordinary case, not a hypothetical one.
    const at = (r: number): number => {
      const result = nextAttempt({
        attemptCount: 4,
        maxAttempts: 10,
        now: NOW,
        random: () => r,
      });
      if (result.outcome !== "retry") throw new Error("expected a retry");
      return result.at.getTime();
    };
    expect(at(0)).toBeLessThan(at(1));
  });

  it("never schedules an attempt in the past, whatever the jitter", () => {
    // A negative or zero delay would make the job immediately due again and
    // spin the runner.
    for (const r of [0, 0.5, 1]) {
      const result = nextAttempt({
        attemptCount: 1,
        maxAttempts: 10,
        now: NOW,
        random: () => r,
      });
      if (result.outcome !== "retry") throw new Error("expected a retry");
      expect(result.at.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });
});
