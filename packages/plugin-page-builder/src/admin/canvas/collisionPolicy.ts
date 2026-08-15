/**
 * The single place the canvas decides which insertion target wins a pointer.
 *
 * Four droppables mark insertion points — the drop zones interleaved between a
 * slot's children, the "drop here" placeholder of an empty slot, and the
 * `before:` / `append:` targets a formatted slot uses instead of zones. They
 * answer ONE question, so they rank by one rule and take their priority from
 * one scale. Anything that computes either alongside will drift, and the drift
 * is silent because both halves look correct on their own.
 *
 * `sortCollisions` in `@dnd-kit/abstract` compares `priority`, THEN `type`,
 * THEN `value`, and each of those tiers is load-bearing here:
 *
 *  - **`priority` is depth**, so the innermost container owns the pointer. It
 *    is the only thing that can separate two IDENTICAL rectangles, which is
 *    what a nested container's edge gap and its parent's gap between children
 *    are. Omitting it is not neutral: a droppable with no `collisionPriority`
 *    keeps the detector's own constant, which outranks every target shallower
 *    than that number however the rectangles lie.
 *  - **`type` is CONSTANT across insertion targets.** The switch margin lives
 *    in `value`, and a detector that reported pointer containment inside a
 *    target and shape overlap outside it would change tier exactly where the
 *    pointer crosses a target's edge — so the target already held is outranked
 *    before its margin is ever compared. One tier is what puts the decision on
 *    the tier the margin can reach.
 *  - **`value` is negated distance in pixels**, so the margin below is a real
 *    distance the pointer has to travel rather than a number whose meaning
 *    changes with how far away things are.
 */
import {
  CollisionPriority,
  CollisionType,
  type CollisionDetector,
} from "@dnd-kit/abstract";
import { defaultCollisionDetection } from "@dnd-kit/collision";

/**
 * How much closer a challenging target must be before the drop target moves.
 *
 * The full width of the switch margin in pixels of pointer travel, not a
 * half-width: releasing the incumbent needs `distance - BAND` to beat the
 * challenger, which puts the switch half a band past the midpoint going one way
 * and half a band short of it coming back.
 */
export const TARGET_SWITCH_BAND_PX = 10;

/**
 * The one collision tier every insertion target reports.
 *
 * Pointer containment rather than a lower tier, because that is what a target
 * already reports at the position where the drop target is most often held:
 * with the pointer inside it. Pinning the tier there keeps that case ranking as
 * it did before this module existed, and lifts only the case where a target was
 * previously demoted for not containing the pointer.
 */
export const INSERTION_COLLISION_TYPE = CollisionType.PointerIntersection;

/** Where a slot's own drop zones rank: the depth its content is rendered at. */
export function zonePriority(depth: number): number {
  return depth;
}

/**
 * Where a node-attached insertion target ranks.
 *
 * `before` marks a position in the slot the node SITS IN, so it ranks with that
 * slot's zones. `append` marks a position in the node's OWN slot, so it ranks
 * with the zones inside it — one level deeper, exactly where `buildSlots`
 * renders that slot's content.
 */
export function nodeTargetPriority(
  depth: number,
  kind: "before" | "append"
): number {
  return kind === "before" ? depth : depth + 1;
}

/**
 * How far the pointer is from an insertion target, in pixels.
 *
 * Vertical distance to the target's centre, plus however far the pointer sits
 * OUTSIDE it horizontally. The horizontal term is zero whenever the pointer is
 * within the target's width, which is every zone in ordinary block flow — those
 * span their container, so a shared horizontal offset would only add the same
 * quantity to every candidate and, under a square root, would stop cancelling
 * and start distorting the vertical comparison it is irrelevant to.
 *
 * It stops being zero exactly where it must: targets in different columns of a
 * formatted slot share a depth and a vertical band, so ranking them by `y`
 * alone makes equal-height targets tie and lets registration order pick the
 * column. The horizontal term is what separates them.
 */
export function insertionDistancePx({
  pointerX,
  pointerY,
  centreX,
  centreY,
  width,
}: {
  pointerX: number;
  pointerY: number;
  centreX: number;
  centreY: number;
  width: number;
}): number {
  const outsideX = Math.max(0, Math.abs(pointerX - centreX) - width / 2);
  return Math.hypot(outsideX, pointerY - centreY);
}

/**
 * A target's rank among the others: higher wins, and the unit is pixels.
 *
 * Negated because `sortCollisions` orders descending while the better candidate
 * is the NEARER one. Linear rather than reciprocal so the margin subtracted
 * here is a distance the pointer can actually travel: the width of the switch
 * margin equals `bandPx` exactly, at any distance and any target spacing.
 */
export function insertionCollisionValue({
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
 * Whether a target is in play at all.
 *
 * The default detection decides it for every target EXCEPT the one currently
 * held. That exception is what makes the margin whole: the default detection
 * stops reporting a target once the dragged feedback no longer overlaps it,
 * which happens BEFORE any neighbour becomes eligible whenever targets are
 * spaced farther apart than that feedback is tall. Without it the held target
 * is dropped at that edge and the drop indicator alternates between a target
 * and nothing — the same flicker the margin exists to remove, arriving through
 * eligibility instead of through ranking.
 *
 * The reprieve is bounded by the pointer staying within the target's width, so
 * leaving the column, the container or the canvas still releases it.
 */
export function isInsertionTargetEligible({
  hasDefaultCollision,
  isCurrentTarget,
  pointerWithinWidth,
}: {
  hasDefaultCollision: boolean;
  isCurrentTarget: boolean;
  pointerWithinWidth: boolean;
}): boolean {
  return hasDefaultCollision || (isCurrentTarget && pointerWithinWidth);
}

/**
 * Rank insertion targets by pointer distance, holding the current one across a
 * margin.
 *
 * Eligibility is delegated to the default detection for every target EXCEPT the
 * one currently held, so no target starts claiming a pointer it would not have
 * claimed before. The exception is what makes the margin whole: the default
 * detection stops reporting a target once the dragged feedback no longer
 * overlaps it, which happens BEFORE any neighbour becomes eligible whenever
 * targets are spaced farther apart than that feedback is tall. Without the
 * exception the held target is dropped at that edge and the drop indicator
 * alternates between a target and nothing — the same flicker the margin exists
 * to remove, arriving through eligibility instead of through ranking.
 *
 * The incumbent's reprieve is bounded by the pointer staying within its width,
 * so leaving the column, the container or the canvas still releases it.
 */
export function createInsertionCollisionDetector(
  bandPx: number = TARGET_SWITCH_BAND_PX
): CollisionDetector {
  return input => {
    const { droppable, dragOperation } = input;
    const eligible = defaultCollisionDetection(input);

    const shape = droppable.shape;
    const pointer = dragOperation.position.current;
    // Without a measured rectangle or a pointer there is no distance to rank
    // by, so whatever the default detection decided stands rather than being
    // replaced by a fabricated ranking.
    if (!shape || !pointer) return eligible;

    const centre = shape.center;
    const { width } = shape.boundingRectangle;
    const isCurrentTarget = dragOperation.target?.id === droppable.id;
    const withinWidth = Math.abs(pointer.x - centre.x) <= width / 2;

    if (
      !isInsertionTargetEligible({
        hasDefaultCollision: eligible !== null,
        isCurrentTarget,
        pointerWithinWidth: withinWidth,
      })
    ) {
      return null;
    }

    return {
      id: droppable.id,
      priority: eligible?.priority ?? CollisionPriority.Normal,
      type: INSERTION_COLLISION_TYPE,
      value: insertionCollisionValue({
        distancePx: insertionDistancePx({
          pointerX: pointer.x,
          pointerY: pointer.y,
          centreX: centre.x,
          centreY: centre.y,
          width,
        }),
        isCurrentTarget,
        bandPx,
      }),
    };
  };
}

/**
 * Shared by every insertion target, and built once because it closes over
 * nothing per-target: the detector reads the held target from the drag
 * operation it is handed, so there is no state to keep.
 */
export const insertionCollisionDetector = createInsertionCollisionDetector();
