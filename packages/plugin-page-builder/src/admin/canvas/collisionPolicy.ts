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
 * Straight-line distance to the target's centre, both axes counted in full.
 *
 * The horizontal term does NOT vanish inside the target's width, and that is
 * the whole point. Zones in ordinary block flow all span their container, so
 * they share a centre `x` and carry an IDENTICAL horizontal offset. It does not
 * cancel arithmetically under a square root, and it does not need to: being the
 * same for every candidate, it cannot reorder them, so the comparison is
 * decided by the vertical gap exactly as if the term were absent. Order is the
 * only thing `sortCollisions` reads, so order is the property to preserve.
 *
 * Where widths DIFFER it must not cancel, and zeroing it inside each target's
 * width is exactly what stops it. A formatted container's `append` rectangle
 * spans all of its children while a child's `before` rectangle spans one
 * column; both then report zero horizontally, both reduce to the vertical gap,
 * and in an equal-height row their centres align and the two TIE — leaving
 * registration order to choose, which can make one of them unreachable. Full
 * distance separates a wide container from the narrow child under the pointer,
 * because their centres are genuinely in different places.
 */
export function insertionDistancePx({
  pointerX,
  pointerY,
  centreX,
  centreY,
}: {
  pointerX: number;
  pointerY: number;
  centreX: number;
  centreY: number;
}): number {
  return Math.hypot(pointerX - centreX, pointerY - centreY);
}

/**
 * How far the pointer is from a target's RECTANGLE, in pixels. Zero inside it.
 *
 * Distinct from {@link insertionDistancePx}, which measures to the insertion
 * line and is what RANKS targets. This one measures to the boundary and is what
 * bounds the reprieve below, because "how far outside the target is the pointer"
 * is a different question from "which target is nearest".
 */
export function insertionEdgeDistancePx({
  pointerX,
  pointerY,
  centreX,
  centreY,
  width,
  height,
}: {
  pointerX: number;
  pointerY: number;
  centreX: number;
  centreY: number;
  width: number;
  height: number;
}): number {
  return Math.hypot(
    Math.max(0, Math.abs(pointerX - centreX) - width / 2),
    Math.max(0, Math.abs(pointerY - centreY) - height / 2)
  );
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
 * The reprieve is bounded by the SAME band, in BOTH axes at once: the pointer
 * must stay within one band of the target's rectangle, measured by
 * {@link insertionEdgeDistancePx}. One distance rather than a per-axis pair,
 * because a hard boundary on either axis is a cliff the margin cannot smooth:
 * gating horizontally on "inside the width" drops the held target the instant
 * the pointer crosses a column edge, so its credit is never compared with the
 * challenger and a small jitter across that edge flips the indicator - the same
 * defect this reprieve exists to remove, rotated ninety degrees. Bounding it
 * matters more than it looks. An unbounded reprieve holds the target for as
 * long as no rival happens to be eligible, which on widely spaced targets is
 * indefinitely — so the margin stops being a margin and the drop indicator
 * sticks to a target the pointer left long ago. Measured on a fixture whose
 * targets sit 400px apart, the unbounded form never released within 27px of
 * reversing. Reusing `bandPx` rather than introducing a second constant keeps
 * one quantity answering "how far does the pointer move before the target
 * changes", which is the thing the requirement actually names.
 */
export function isInsertionTargetEligible({
  hasDefaultCollision,
  isCurrentTarget,
  edgeDistancePx,
  bandPx,
}: {
  hasDefaultCollision: boolean;
  isCurrentTarget: boolean;
  edgeDistancePx: number;
  bandPx: number;
}): boolean {
  if (hasDefaultCollision) return true;
  return isCurrentTarget && edgeDistancePx <= bandPx;
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
    const { width, height } = shape.boundingRectangle;
    const isCurrentTarget = dragOperation.target?.id === droppable.id;

    if (
      !isInsertionTargetEligible({
        hasDefaultCollision: eligible !== null,
        isCurrentTarget,
        edgeDistancePx: insertionEdgeDistancePx({
          pointerX: pointer.x,
          pointerY: pointer.y,
          centreX: centre.x,
          centreY: centre.y,
          width,
          height,
        }),
        bandPx,
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
