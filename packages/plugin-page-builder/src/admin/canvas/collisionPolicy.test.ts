/**
 * The property under test is the WIDTH of the switch margin, in pixels of
 * pointer travel, read out of the same sort the canvas ranks with.
 *
 * Two things this deliberately does not do, because each of them is a way to
 * pass while measuring something else:
 *
 *  - **It never compares two `value` numbers directly.** `sortCollisions` reads
 *    `priority` and `type` first, so a margin can be correct in `value` and
 *    never reach the comparison. Every ranking assertion below goes through the
 *    real `sortCollisions`, which is the only thing that can show the margin is
 *    actually consulted.
 *  - **It sweeps the pointer and observes where the winner changes**, rather
 *    than asserting an arithmetic identity. The margin is a claim about pointer
 *    movement, so it is measured in pointer movement.
 */
import {
  CollisionType,
  sortCollisions,
  type Collision,
} from "@dnd-kit/abstract";
import { describe, expect, it } from "vitest";

import {
  INSERTION_COLLISION_TYPE,
  TARGET_SWITCH_BAND_PX,
  insertionCollisionValue,
  insertionDistancePx,
  insertionEdgeDistancePx,
  isInsertionTargetEligible,
} from "./collisionPolicy";

/**
 * Zones interleaved in block flow span their container, so the pointer is always
 * horizontally inside them and only `y` varies. Fixing that half here keeps the
 * margin measurements below about the axis the margin acts on; the horizontal
 * term gets its own tests further down.
 */
const ZONE_WIDTH_PX = 800;
const POINTER_X = 400;
function distanceInColumn(
  pointerY: number,
  centreY: number,
  pointerX: number = POINTER_X
): number {
  return insertionDistancePx({
    pointerX,
    pointerY,
    centreX: POINTER_X,
    centreY,
  });
}

/** Two adjacent zones from the flat-list geometry: 60px apart, centred on the
 *  insertion line each one marks. */
const ZONE_A_CENTRE_Y = 120;
const ZONE_B_CENTRE_Y = 180;
const ZONE_PITCH_PX = ZONE_B_CENTRE_Y - ZONE_A_CENTRE_Y;

/**
 * One ranking round, assembled the way the collision observer assembles it:
 * a collision per zone, then `sortCollisions`, then the winner is the head.
 *
 * `priority` is equal for both because sibling zones share a container and
 * therefore a depth. That equality is what puts the decision on the tiers this
 * module controls, and it is the real arrangement rather than a convenience.
 */
function winnerAt({
  pointerY,
  currentTargetId,
  bandPx = TARGET_SWITCH_BAND_PX,
  typeFor = () => INSERTION_COLLISION_TYPE,
  pointerX = POINTER_X,
}: {
  pointerY: number;
  currentTargetId: string | null;
  bandPx?: number;
  typeFor?: (id: string) => CollisionType;
  pointerX?: number;
}): string {
  const collisions: Collision[] = [
    { id: "a", centre: ZONE_A_CENTRE_Y },
    { id: "b", centre: ZONE_B_CENTRE_Y },
  ].map(zone => ({
    id: zone.id,
    priority: 1,
    type: typeFor(zone.id),
    value: insertionCollisionValue({
      distancePx: distanceInColumn(pointerY, zone.centre, pointerX),
      isCurrentTarget: currentTargetId === zone.id,
      bandPx,
    }),
  }));

  collisions.sort(sortCollisions);
  const winner = collisions[0]?.id;
  if (typeof winner !== "string") {
    throw new Error("a ranking round must produce a winner");
  }
  return winner;
}

/**
 * Walk the pointer one pixel at a time, carrying the winner forward as the
 * incumbent, and report where the target first changes.
 *
 * Carrying it forward is the whole point: the margin only exists relative to a
 * target that is already held, so a sweep that recomputes from no incumbent
 * measures the midpoint and reports no margin at all.
 */
function firstSwitchY({
  from,
  to,
  startTargetId,
  bandPx = TARGET_SWITCH_BAND_PX,
  typeFor,
  pointerX,
}: {
  from: number;
  to: number;
  startTargetId: string;
  bandPx?: number;
  typeFor?: (id: string) => CollisionType;
  pointerX?: number;
}): number | null {
  const step = Math.sign(to - from);
  let target = startTargetId;
  for (let y = from; y !== to + step; y += step) {
    const winner = winnerAt({
      pointerY: y,
      currentTargetId: target,
      bandPx,
      typeFor,
      pointerX,
    });
    if (winner !== target) return y;
    target = winner;
  }
  return null;
}

describe("insertionDistancePx", () => {
  it("is the vertical gap to the target centre when horizontally inside", () => {
    expect(distanceInColumn(100, 120)).toBe(20);
    expect(distanceInColumn(140, 120)).toBe(20);
    expect(distanceInColumn(120, 120)).toBe(0);
  });
});

describe("the switch margin, measured in pointer travel", () => {
  it("is exactly TARGET_SWITCH_BAND_PX wide across the real sort", () => {
    // Down from A's centre to B's centre, then back. The two crossings sit
    // symmetrically about the midpoint, so their separation IS the margin.
    const down = firstSwitchY({
      from: ZONE_A_CENTRE_Y,
      to: ZONE_B_CENTRE_Y,
      startTargetId: "a",
    });
    const up = firstSwitchY({
      from: ZONE_B_CENTRE_Y,
      to: ZONE_A_CENTRE_Y,
      startTargetId: "b",
    });

    expect(down, "the target must eventually move to b").not.toBeNull();
    expect(up, "the target must eventually move back to a").not.toBeNull();
    // Integer stepping resolves each crossing to within a pixel, so the width
    // derived from two of them carries both errors.
    expect(Number(down) - Number(up)).toBeCloseTo(TARGET_SWITCH_BAND_PX, -0.5);
  });

  it("lands inside the 8-12px the canvas requires", () => {
    const down = Number(
      firstSwitchY({
        from: ZONE_A_CENTRE_Y,
        to: ZONE_B_CENTRE_Y,
        startTargetId: "a",
      })
    );
    const up = Number(
      firstSwitchY({
        from: ZONE_B_CENTRE_Y,
        to: ZONE_A_CENTRE_Y,
        startTargetId: "b",
      })
    );
    const width = down - up;

    expect(width).toBeGreaterThanOrEqual(8);
    expect(width).toBeLessThanOrEqual(12);
  });

  it("collapses to zero when the margin is zero", () => {
    // The control that separates "this measures the margin" from "this measures
    // some other asymmetry in the sweep". With no margin both crossings must
    // fall on the same pixel.
    const down = firstSwitchY({
      from: ZONE_A_CENTRE_Y,
      to: ZONE_B_CENTRE_Y,
      startTargetId: "a",
      bandPx: 0,
    });
    const up = firstSwitchY({
      from: ZONE_B_CENTRE_Y,
      to: ZONE_A_CENTRE_Y,
      startTargetId: "b",
      bandPx: 0,
    });

    expect(Number(down) - Number(up)).toBeLessThanOrEqual(1);
  });

  it("holds the target through a jitter narrower than the margin", () => {
    // The canvas-level symptom, stated at the ranking layer: a pointer bracketed
    // at the midpoint and moved by less than the margin must not change target.
    const midpoint = ZONE_A_CENTRE_Y + ZONE_PITCH_PX / 2;
    let target = "a";
    const seen = new Set<string>();
    for (const y of [midpoint, midpoint + 2, midpoint - 2, midpoint + 2]) {
      target = winnerAt({ pointerY: y, currentTargetId: target });
      seen.add(target);
    }

    expect([...seen], "a 2px jitter must not move the target").toEqual(["a"]);
  });
});

describe("the margin's width away from a zone's horizontal centre", () => {
  // The property an ordering-only test cannot see. A metric that combines the
  // axes under a square root subtracts the margin from the HYPOTENUSE, so the
  // vertical band grows with horizontal offset: measured at 100px off-centre it
  // becomes roughly 36px against a 10px requirement, and further out the
  // challenger can never overtake the incumbent at all. Ordering stays correct
  // throughout, so only a WIDTH assertion off-centre separates the two metrics.
  function bandWidthAt(pointerX: number): number {
    const down = firstSwitchY({
      from: ZONE_A_CENTRE_Y,
      to: ZONE_B_CENTRE_Y,
      startTargetId: "a",
      pointerX,
    });
    const up = firstSwitchY({
      from: ZONE_B_CENTRE_Y,
      to: ZONE_A_CENTRE_Y,
      startTargetId: "b",
      pointerX,
    });
    return Number(down) - Number(up);
  }

  it("is the same 8-12px at the centre and far off it", () => {
    for (const offset of [0, 100, 300]) {
      const width = bandWidthAt(POINTER_X + offset);
      expect(width, `at ${String(offset)}px off-centre`).toBeGreaterThanOrEqual(
        8
      );
      expect(width, `at ${String(offset)}px off-centre`).toBeLessThanOrEqual(
        12
      );
    }
  });

  it("does not drift as the pointer moves sideways", () => {
    expect(bandWidthAt(POINTER_X + 300)).toBe(bandWidthAt(POINTER_X));
  });
});

describe("what the uniform collision tier is load-bearing for", () => {
  it("loses the margin entirely when the tier is allowed to vary", () => {
    // The mutation this design exists to survive. Reporting containment inside a
    // zone and a lower tier outside it is what the default detection does, and
    // `sortCollisions` reads the tier BEFORE the value, so the incumbent is
    // outranked the moment the pointer enters the challenger's 6px rect and the
    // margin is never consulted. If this ever stops failing, the uniform tier
    // has stopped doing anything and the margin is decorative.
    const varyingTier = (id: string): CollisionType =>
      // b claims containment as soon as the pointer is within its rect.
      id === "b"
        ? CollisionType.PointerIntersection
        : CollisionType.ShapeIntersection;

    const down = firstSwitchY({
      from: ZONE_A_CENTRE_Y,
      to: ZONE_B_CENTRE_Y,
      startTargetId: "a",
      typeFor: varyingTier,
    });

    // b outranks a on the tier at every position, so the target moves on the
    // very first step rather than after half a pitch plus half a margin.
    expect(down).toBe(ZONE_A_CENTRE_Y);
  });

  it("is the tier a zone already reports with the pointer inside it", () => {
    expect(INSERTION_COLLISION_TYPE).toBe(CollisionType.PointerIntersection);
  });
});

describe("insertionCollisionValue", () => {
  it("ranks the nearer zone higher", () => {
    const near = insertionCollisionValue({
      distancePx: 5,
      isCurrentTarget: false,
      bandPx: 10,
    });
    const far = insertionCollisionValue({
      distancePx: 25,
      isCurrentTarget: false,
      bandPx: 10,
    });

    expect(near).toBeGreaterThan(far);
  });

  it("credits the incumbent exactly the margin, in pixels", () => {
    const challenger = insertionCollisionValue({
      distancePx: 30,
      isCurrentTarget: false,
      bandPx: 10,
    });
    const incumbent = insertionCollisionValue({
      distancePx: 30,
      isCurrentTarget: true,
      bandPx: 10,
    });

    // Linear and negated, so the credit reads back as a plain pixel difference
    // rather than something that has to be inverted to be interpreted.
    expect(incumbent - challenger).toBe(10);
  });
});

describe("the horizontal term, which separates targets of unequal width", () => {
  const COLUMN_WIDTH = 300;
  const LEFT_CENTRE_X = 150;
  const RIGHT_CENTRE_X = 450;
  const ROW_CENTRE_Y = 200;
  // A formatted container's `append` rectangle spans every child, so its centre
  // sits between the columns rather than over one of them.
  const CONTAINER_CENTRE_X = 300;

  const at = (
    pointerX: number,
    centreX: number,
    centreY = ROW_CENTRE_Y
  ): number =>
    insertionDistancePx({ pointerX, pointerY: ROW_CENTRE_Y, centreX, centreY });

  it("keeps the ORDER vertical between targets that share a centre", () => {
    // Every zone in ordinary block flow spans its container, so they share a
    // centre x and carry an identical horizontal offset. That offset does not
    // cancel arithmetically under a square root, and it does not need to: it is
    // the same for both candidates, so it cannot reorder them. The comparison
    // is decided by the vertical gap exactly as if the term were absent, which
    // is the property the ranking actually depends on.
    const offCentreX = POINTER_X + 380;
    const pointerY = 200;
    const nearerVertically = at(offCentreX, POINTER_X, pointerY - 40);
    const furtherVertically = at(offCentreX, POINTER_X, pointerY - 100);

    expect(nearerVertically).toBeLessThan(furtherVertically);
  });

  it("does not tie two columns at the same height", () => {
    expect(at(LEFT_CENTRE_X, LEFT_CENTRE_X)).toBe(0);
    expect(
      at(LEFT_CENTRE_X, RIGHT_CENTRE_X),
      "the far column must not tie with the one under the pointer"
    ).toBeGreaterThan(0);
  });

  it("separates a container's append target from the child under the pointer", () => {
    // The case a zero-inside-the-width term cannot see: the container's
    // rectangle spans both columns, so the pointer is horizontally INSIDE it
    // and inside the child at once. Zeroing the term there makes both reduce to
    // the vertical gap, and with their centres aligned the two tie and
    // registration order decides which is reachable.
    const toChild = at(LEFT_CENTRE_X, LEFT_CENTRE_X);
    const toContainer = at(LEFT_CENTRE_X, CONTAINER_CENTRE_X);

    expect(toChild).toBeLessThan(toContainer);
  });

  it("grows with horizontal separation rather than only outside a boundary", () => {
    expect(at(LEFT_CENTRE_X + 10, LEFT_CENTRE_X)).toBe(10);
    expect(at(LEFT_CENTRE_X + 160, LEFT_CENTRE_X)).toBe(160);
  });
});

describe("insertionEdgeDistancePx, which bounds the reprieve", () => {
  const rect = { centreX: 150, centreY: 200, width: 300, height: 40 };

  it("is zero anywhere inside the rectangle", () => {
    // The property the RANKING metric deliberately does not have. Bounding the
    // reprieve asks "how far outside the target is the pointer", which is a
    // different question from "which target is nearest".
    expect(
      insertionEdgeDistancePx({ pointerX: 150, pointerY: 200, ...rect })
    ).toBe(0);
    expect(
      insertionEdgeDistancePx({ pointerX: 300, pointerY: 220, ...rect })
    ).toBe(0);
  });

  it("measures from the nearest edge once outside, on either axis", () => {
    expect(
      insertionEdgeDistancePx({ pointerX: 310, pointerY: 200, ...rect })
    ).toBe(10);
    expect(
      insertionEdgeDistancePx({ pointerX: 150, pointerY: 230, ...rect })
    ).toBe(10);
  });
});

describe("eligibility, which the margin depends on", () => {
  // The margin lives in the ranking, so it can only act on targets that are
  // still IN the ranking. The default detection stops reporting a target once
  // the dragged feedback no longer overlaps it, and where targets are spaced
  // farther apart than that feedback is tall, that happens before any
  // neighbour becomes eligible — the held target is dropped and the indicator
  // alternates between a target and nothing, which is the flicker arriving
  // through eligibility rather than through ranking.
  const held = {
    hasDefaultCollision: false,
    isCurrentTarget: true,
    edgeDistancePx: 0,
    bandPx: TARGET_SWITCH_BAND_PX,
  };

  it("keeps the held target when the default detection drops it", () => {
    expect(isInsertionTargetEligible(held)).toBe(true);
  });

  it("keeps it right up to the edge of the band", () => {
    expect(
      isInsertionTargetEligible({
        ...held,
        edgeDistancePx: TARGET_SWITCH_BAND_PX,
      })
    ).toBe(true);
  });

  it("releases it one pixel past the band", () => {
    // The bound that stops the reprieve becoming unbounded stickiness. Without
    // it the held target survives for as long as no rival happens to be
    // eligible, which on widely spaced targets is indefinitely: the margin
    // stops being a margin and the indicator clings to a target the pointer
    // left long ago.
    expect(
      isInsertionTargetEligible({
        ...held,
        edgeDistancePx: TARGET_SWITCH_BAND_PX + 1,
      })
    ).toBe(false);
  });

  it("does not extend the reprieve to a target that is not held", () => {
    // Otherwise every target in the document stays in the ranking forever.
    expect(isInsertionTargetEligible({ ...held, isCurrentTarget: false })).toBe(
      false
    );
  });

  it("bounds the reprieve on the HORIZONTAL axis by the same band", () => {
    // A hard "inside the width" gate would drop the held target the instant the
    // pointer crossed a column edge, so its credit would never be compared with
    // the challenger and a small jitter across that edge would flip the
    // indicator. One distance covers both axes, so neither is a cliff.
    expect(
      isInsertionTargetEligible({
        ...held,
        edgeDistancePx: TARGET_SWITCH_BAND_PX - 1,
      })
    ).toBe(true);
  });

  it("admits anything the default detection already admits", () => {
    // Eligibility is never NARROWED, so no target stops claiming a pointer it
    // claimed before this module existed — including well outside the band.
    for (const isCurrentTarget of [true, false]) {
      {
        expect(
          isInsertionTargetEligible({
            hasDefaultCollision: true,
            isCurrentTarget,
            edgeDistancePx: 10_000,
            bandPx: TARGET_SWITCH_BAND_PX,
          })
        ).toBe(true);
      }
    }
  });
});
