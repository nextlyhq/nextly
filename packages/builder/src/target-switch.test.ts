import { describe, expect, it } from "vitest";

import {
  NO_TARGET,
  nextTargetSwitchState,
  type TargetId,
  type TargetSwitchState,
} from "./target-switch";
import type { Point } from "./geometry";

/**
 * Far enough that a hand tremor cannot reach it and short enough that a
 * deliberate crossing does not feel held back. Every case below states its
 * distances relative to this rather than restating the number, so the
 * assertions keep meaning what they say if it is retuned.
 */
const THRESHOLD = 12;

/** Feeds a run of (candidate, pointer) moves through the rule. */
function drag(
  moves: readonly (readonly [TargetId, Point])[],
  from: TargetSwitchState = NO_TARGET
): TargetSwitchState {
  return moves.reduce(
    (state, [candidate, pointer]) =>
      nextTargetSwitchState(state, candidate, pointer, THRESHOLD),
    from
  );
}

/** Every target the rule commits to across a run, in order, without repeats. */
function committedRun(
  moves: readonly (readonly [TargetId, Point])[]
): TargetId[] {
  const seen: TargetId[] = [];
  moves.reduce((state, [candidate, pointer]) => {
    const next = nextTargetSwitchState(state, candidate, pointer, THRESHOLD);
    if (next.committed !== state.committed) seen.push(next.committed);
    return next;
  }, NO_TARGET);
  return seen;
}

describe("acquiring the first target", () => {
  it("commits immediately, because there is nothing to flicker between yet", () => {
    // Withholding this would leave a drag with no indicator until the pointer
    // had travelled the threshold, which reads as the canvas not responding.
    expect(drag([["a", { x: 0, y: 0 }]]).committed).toBe("a");
  });
});

describe("a pointer jittering at a seam", () => {
  /**
   * The anti-flicker requirement, stated as the outcome rather than as the
   * presence of a threshold: a hand tremor at a boundary must not move the
   * target, however many times the collision engine changes its mind.
   */
  it("never switches, however long the jitter goes on", () => {
    const settled = drag([["a", { x: 100, y: 100 }]]);

    const jitter: (readonly [TargetId, Point])[] = [];
    for (let i = 0; i < 40; i += 1) {
      // 2px apart, which is what a resting hand produces, and the candidate
      // alternates with it exactly as a boundary makes it.
      jitter.push([i % 2 === 0 ? "b" : "a", { x: 100, y: 100 + (i % 2) * 2 }]);
    }

    expect(drag(jitter, settled).committed).toBe("a");
  });

  /**
   * The positive control for the case above, and it is not optional: a rule that
   * never switches at all satisfies "no flicker" perfectly, so the assertion
   * above is only evidence once a deliberate crossing is shown to work through
   * the identical helper.
   */
  it("still switches for a deliberate crossing, through the same helper", () => {
    const settled = drag([["a", { x: 100, y: 100 }]]);

    expect(
      drag(
        [
          ["b", { x: 100, y: 100 }],
          ["b", { x: 100, y: 100 + THRESHOLD }],
        ],
        settled
      ).committed
    ).toBe("b");
  });
});

describe("where the threshold is measured FROM", () => {
  /**
   * The property that separates this rule from the plausible version of it.
   *
   * Anchoring at the last SWITCH instead reads perfectly well and collapses in
   * the commonest case: an author dragging from the block library crosses most
   * of the page before reaching a seam, so the distance since the last switch is
   * already far past the threshold on arrival and the first pixel over the
   * boundary switches instantly.
   *
   * A long approach INSIDE the committed target followed by a single pixel over
   * the boundary is exactly that case, and the two implementations disagree on
   * it: measuring from the last switch commits `b`, measuring from where the
   * candidate changed does not.
   */
  it("does not switch on a 1px crossing after a long approach", () => {
    const approach: (readonly [TargetId, Point])[] = [];
    for (let y = 0; y <= 400; y += 20) approach.push(["a", { x: 100, y }]);

    // 400px travelled, all of it inside `a`, then one pixel into `b`.
    const state = drag([...approach, ["b", { x: 100, y: 401 }]]);

    expect(state.committed).toBe("a");
    expect(state.pending?.target).toBe("b");
  });

  it("switches once the crossing ITSELF has covered the threshold", () => {
    const approach: (readonly [TargetId, Point])[] = [];
    for (let y = 0; y <= 400; y += 20) approach.push(["a", { x: 100, y }]);

    expect(
      drag([
        ...approach,
        ["b", { x: 100, y: 401 }],
        ["b", { x: 100, y: 401 + THRESHOLD }],
      ]).committed
    ).toBe("b");
  });

  it("measures the crossing from where the candidate changed, not from the seam", () => {
    // The anchor is a pointer position the rule recorded, not a boundary it
    // knows about — it reads no geometry at all — so a candidate appearing far
    // from any seam is measured from where it appeared.
    const state = drag([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 500, y: 500 }],
    ]);

    expect(state.pending?.anchor).toEqual({ x: 500, y: 500 });
  });
});

describe("what counts as travel", () => {
  /**
   * Displacement, never path length. A pointer sawing back and forth across a
   * seam accumulates unbounded path while going nowhere, so a path measure would
   * eventually grant the switch it exists to withhold — and it would do so after
   * a delay, which is worse than granting it at once because it is
   * unreproducible.
   */
  it("does not accumulate from a pointer that keeps returning to where it started", () => {
    const settled = drag([["a", { x: 0, y: 0 }]]);

    const sawing: (readonly [TargetId, Point])[] = [];
    for (let i = 0; i < 60; i += 1) {
      // Total path length is 60 x (THRESHOLD - 1), far past the threshold;
      // displacement from the anchor never exceeds THRESHOLD - 1.
      sawing.push(["b", { x: 0, y: i % 2 === 0 ? 0 : THRESHOLD - 1 }]);
    }

    expect(drag(sawing, settled).committed).toBe("a");
  });
});

describe("a rival that changes its mind", () => {
  it("restarts the measurement when a DIFFERENT rival appears", () => {
    // The distance covered while `b` was pending says nothing about how far the
    // pointer has moved since `c` appeared, so `c` starts from where it arrived.
    const state = drag([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 0, y: 5 }],
      ["c", { x: 0, y: 10 }],
    ]);

    expect(state.committed).toBe("a");
    expect(state.pending).toEqual({ target: "c", anchor: { x: 0, y: 10 } });
  });

  it("drops a rival that goes back to agreeing with the committed target", () => {
    // Left pending, its stale anchor would be inherited by a later return to the
    // same value and grant a switch on a crossing that never happened.
    const state = drag([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 0, y: 5 }],
      ["a", { x: 0, y: 5 }],
    ]);

    expect(state.pending).toBeNull();
  });

  it("does not inherit a stale anchor when the same rival returns", () => {
    const state = drag([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 0, y: 0 }],
      ["a", { x: 0, y: 0 }],
      // `b` reappears having travelled the threshold's worth since it FIRST
      // appeared. Measured from that first sighting it would switch; measured
      // from this one it must not.
      ["b", { x: 0, y: THRESHOLD }],
    ]);

    expect(state.committed).toBe("a");
  });
});

describe("losing the target", () => {
  it("holds an empty candidate to the same threshold as a rival", () => {
    // Dropping the target at a boundary flickers exactly as gaining the wrong
    // one does, so `null` is an ordinary candidate rather than an absence.
    const settled = drag([["a", { x: 0, y: 0 }]]);

    expect(drag([[null, { x: 0, y: 1 }]], settled).committed).toBe("a");
    expect(
      drag(
        [
          [null, { x: 0, y: 1 }],
          [null, { x: 0, y: 1 + THRESHOLD }],
        ],
        settled
      ).committed
    ).toBeNull();
  });
});

describe("the committed sequence over a whole drag", () => {
  it("commits each target once, in the order the pointer reached them", () => {
    // Asserted as the SEQUENCE rather than as a final value: a rule that
    // switched to `b`, back to `a`, then to `b` again ends on the same answer
    // while having flickered twice on the way, and only the run separates them.
    expect(
      committedRun([
        ["a", { x: 0, y: 0 }],
        ["b", { x: 0, y: 40 }],
        ["b", { x: 0, y: 40 + THRESHOLD }],
        ["c", { x: 0, y: 80 }],
        ["c", { x: 0, y: 80 + THRESHOLD }],
      ])
    ).toEqual(["a", "b", "c"]);
  });
});

describe("the threshold itself", () => {
  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])(
    "refuses %p rather than silently disabling the rule",
    invalid => {
      // `NaN` is the one that matters: every comparison against it is false, so
      // the rule would withhold every switch forever while looking configured.
      expect(() =>
        nextTargetSwitchState(NO_TARGET, "a", { x: 0, y: 0 }, invalid)
      ).toThrow(RangeError);
    }
  );

  it("switches on the next move when the threshold is zero", () => {
    // Zero is a legitimate request for no hysteresis, and it must not be
    // confused with the invalid values above.
    const settled = nextTargetSwitchState(NO_TARGET, "a", { x: 0, y: 0 }, 0);

    expect(
      nextTargetSwitchState(settled, "b", { x: 0, y: 0 }, 0).committed
    ).toBe("b");
  });
});
