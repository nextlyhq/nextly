/**
 * Ranking for the drop zones interleaved between a slot's children.
 *
 * Zones are 6px tall and centred exactly on the insertion line they mark, so
 * "which zone should own the pointer" is a question about one number: the
 * vertical gap between the pointer and each zone's centre. This module answers
 * it in pixels and adds a switch margin, so a pointer resting near a boundary
 * keeps the target it already has instead of flipping on every small movement.
 *
 * Two properties of `sortCollisions` in `@dnd-kit/abstract` shape everything
 * here, because it compares `priority`, THEN `type`, and only THEN `value`:
 *
 *  - **The margin has to live in `value`, so `type` must not vary.** A detector
 *    that reports pointer containment inside a zone and shape overlap outside it
 *    changes tier as the pointer crosses the zone's own edge, and a margin
 *    expressed in `value` is never consulted across that change — the incumbent
 *    is outranked before its margin is read. Reporting ONE type for every zone
 *    is what keeps the comparison on the tier the margin can reach.
 *  - **`priority` is left alone.** A zone carries its container's depth as
 *    `collisionPriority`, which the collision observer writes over whatever a
 *    detector returns, so depth stays the primary key and a nested container
 *    keeps winning against the identical rectangle of its parent's gap.
 */
import { CollisionType, type CollisionDetector } from "@dnd-kit/abstract";
import { defaultCollisionDetection } from "@dnd-kit/collision";

/**
 * How much closer a challenging zone must be before the target moves to it.
 *
 * This is the full width of the switch margin in pixels of pointer movement,
 * not a half-width: releasing the incumbent needs `distance - BAND` to beat the
 * challenger, which moves the switch point half a band past the midpoint going
 * one way and half a band short of it coming back.
 */
export const TARGET_SWITCH_BAND_PX = 10;

/**
 * The single collision tier every interleaved zone reports.
 *
 * Pointer containment rather than a lower tier, because that is what a zone
 * already reports at the position where a target is most often held: with the
 * pointer inside its 6px rect. Pinning the tier there keeps that case ranking
 * as it does without this module, and lifts only the case where a zone was
 * previously demoted for not containing the pointer.
 */
export const ZONE_COLLISION_TYPE = CollisionType.PointerIntersection;

/**
 * The pointer's distance from a zone, measured along the axis the zone divides.
 *
 * Vertical only, and that is narrower than a straight line on purpose. Zones
 * interleaved in block flow span their container's full width, so every zone
 * competing on `value` is the same horizontal distance from the pointer; a
 * two-axis distance would fold that shared term in under a square root, where
 * it stops cancelling and starts distorting the vertical comparison it is
 * irrelevant to.
 */
export function zoneDistancePx(pointerY: number, zoneCentreY: number): number {
  return Math.abs(pointerY - zoneCentreY);
}

/**
 * A zone's rank among its siblings: higher wins, and the unit is pixels.
 *
 * Negated because `sortCollisions` orders descending while the better candidate
 * is the NEARER one. Kept linear rather than reciprocal so that the margin
 * subtracted below is a distance the pointer can actually travel — the width of
 * the switch margin equals `bandPx` exactly, at any distance and any zone
 * spacing, which is what makes it assertable in pixels of pointer movement.
 */
export function zoneCollisionValue({
  distancePx,
  isCurrentTarget,
  bandPx,
}: {
  distancePx: number;
  isCurrentTarget: boolean;
  bandPx: number;
}): number {
  return -(isCurrentTarget ? distancePx - bandPx : distancePx);
}

/**
 * Rank zones by pointer distance, holding the current target across a margin.
 *
 * Eligibility is delegated rather than reimplemented: the default detection
 * decides WHETHER a zone is in play at all, exactly as it does without this
 * module, and only the ranking among the zones it admits is replaced. A zone
 * the default detection rejects is still rejected here, so no zone starts
 * claiming a pointer it would not have claimed before.
 */
export function createZoneCollisionDetector(
  bandPx: number = TARGET_SWITCH_BAND_PX
): CollisionDetector {
  return input => {
    const eligible = defaultCollisionDetection(input);
    if (!eligible) return null;

    const { droppable, dragOperation } = input;
    const centre = droppable.shape?.center;
    const pointer = dragOperation.position.current;
    // Without a measured rectangle or a pointer there is no distance to rank
    // by, so the delegated result stands rather than being replaced by a
    // fabricated one.
    if (!centre || !pointer) return eligible;

    return {
      id: droppable.id,
      priority: eligible.priority,
      // One tier for every zone. See the module comment: a varying tier
      // outranks the margin below before it is ever compared.
      type: ZONE_COLLISION_TYPE,
      value: zoneCollisionValue({
        distancePx: zoneDistancePx(pointer.y, centre.y),
        isCurrentTarget: dragOperation.target?.id === droppable.id,
        bandPx,
      }),
    };
  };
}
