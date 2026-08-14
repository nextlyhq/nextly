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
  TARGET_SWITCH_BAND_PX,
  ZONE_COLLISION_TYPE,
  zoneCollisionValue,
  zoneDistancePx,
} from "./zoneCollision";

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
  typeFor = () => ZONE_COLLISION_TYPE,
}: {
  pointerY: number;
  currentTargetId: string | null;
  bandPx?: number;
  typeFor?: (id: string) => CollisionType;
}): string {
  const collisions: Collision[] = [
    { id: "a", centre: ZONE_A_CENTRE_Y },
    { id: "b", centre: ZONE_B_CENTRE_Y },
  ].map(zone => ({
    id: zone.id,
    priority: 1,
    type: typeFor(zone.id),
    value: zoneCollisionValue({
      distancePx: zoneDistancePx(pointerY, zone.centre),
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
}: {
  from: number;
  to: number;
  startTargetId: string;
  bandPx?: number;
  typeFor?: (id: string) => CollisionType;
}): number | null {
  const step = Math.sign(to - from);
  let target = startTargetId;
  for (let y = from; y !== to + step; y += step) {
    const winner = winnerAt({
      pointerY: y,
      currentTargetId: target,
      bandPx,
      typeFor,
    });
    if (winner !== target) return y;
    target = winner;
  }
  return null;
}

describe("zoneDistancePx", () => {
  it("is the vertical gap to the zone centre, unsigned", () => {
    expect(zoneDistancePx(100, 120)).toBe(20);
    expect(zoneDistancePx(140, 120)).toBe(20);
    expect(zoneDistancePx(120, 120)).toBe(0);
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
    expect(ZONE_COLLISION_TYPE).toBe(CollisionType.PointerIntersection);
  });
});

describe("zoneCollisionValue", () => {
  it("ranks the nearer zone higher", () => {
    const near = zoneCollisionValue({
      distancePx: 5,
      isCurrentTarget: false,
      bandPx: 10,
    });
    const far = zoneCollisionValue({
      distancePx: 25,
      isCurrentTarget: false,
      bandPx: 10,
    });

    expect(near).toBeGreaterThan(far);
  });

  it("credits the incumbent exactly the margin, in pixels", () => {
    const challenger = zoneCollisionValue({
      distancePx: 30,
      isCurrentTarget: false,
      bandPx: 10,
    });
    const incumbent = zoneCollisionValue({
      distancePx: 30,
      isCurrentTarget: true,
      bandPx: 10,
    });

    // Linear and negated, so the credit reads back as a plain pixel difference
    // rather than something that has to be inverted to be interpreted.
    expect(incumbent - challenger).toBe(10);
  });
});
