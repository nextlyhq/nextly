/**
 * The single place the canvas decides which insertion target wins a pointer.
 *
 * Scoped to the zones INTERLEAVED between a slot's children, and the scope is
 * load-bearing rather than incidental. Those zones all span the same container,
 * so they share a width and an axis, and two things follow that this ranking
 * depends on: a margin measured on one axis is a constant physical width for
 * them, and "the pointer is inside this zone" and "this zone's centre is the
 * nearest" are the same statement.
 *
 * The canvas's other insertion targets hold neither property. An empty slot's
 * placeholder can sit beside a container of a different width; a formatted
 * slot's `before:` and `append:` targets are whole blocks, arranged on either
 * axis and sometimes staggered in both. For them a single distance cannot carry
 * both "which target owns the pointer" and "how far is the pointer from the
 * insertion line, in pixels" — a rotation-invariant metric stops the margin
 * being axis-aligned, an axis-aligned one stops it being a constant width, and
 * ranking every target on one tier loses the containment ordering that decides
 * which container a drop belongs to. Those targets keep the default ranking
 * until a detector exists that resolves a REGION before it measures a distance.
 *
 * `sortCollisions` in `@dnd-kit/abstract` compares `priority`, THEN `type`,
 * THEN `value`, and each of those tiers is load-bearing here:
 *
 *  - **`priority` is the canvas depth scale**, which this module leaves alone:
 *    `canvasPriority` owns it, and the collision observer applies it after the
 *    detector has returned, so nothing here can affect which container claims
 *    the pointer.
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

/**
 * How far the pointer is from an insertion target, in pixels.
 *
 * The two axes SUMMED, not combined under a square root.
 *
 * Additive is what keeps the switch margin meaning what it says. The margin is
 * subtracted from this number, so if the axes were combined by `hypot` it would
 * come off the HYPOTENUSE: a pointer 100px from a full-width zone's centre
 * turns a 10px credit into roughly a 36px vertical band, and further out the
 * challenger cannot overtake the incumbent at all before eligibility ends it.
 * The margin would then be a different size everywhere, which is precisely what
 * "8-12px of pointer travel" rules out.
 *
 * Summed, the horizontal term is a constant added to both candidates whenever
 * they share a centre `x` — every zone in ordinary block flow, since they span
 * their container — so it cancels EXACTLY out of the subtraction and the band
 * stays 10px of vertical travel at any horizontal offset.
 *
 * It stops cancelling exactly where it should: a formatted container's `append`
 * rectangle is centred between its children while a child's `before` rectangle
 * is centred on one column, so their horizontal terms differ and the child
 * under the pointer wins instead of the two tying on the vertical gap alone.
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
  return Math.abs(pointerY - centreY) + Math.abs(pointerX - centreX);
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
