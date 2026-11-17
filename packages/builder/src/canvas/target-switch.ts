/**
 * When a drag is allowed to change its drop target.
 *
 * A pointer resting near the boundary between two drop targets jitters by a pixel
 * or two, and the target underneath it alternates with the jitter. Committed
 * directly, that alternation is visible as a flickering insertion indicator and as
 * a block landing somewhere the author did not aim — the two failures this rule
 * exists to remove.
 *
 * The rule: **a candidate target must hold while the pointer travels a set
 * distance before it replaces the committed one.**
 *
 * @remarks
 * **Why distance rather than a dwell timer.** A timer makes the editor's
 * behaviour depend on how long the author hesitates, so a slow deliberate drag
 * and a jitter become indistinguishable, and the delay is felt on every genuine
 * boundary crossing. Distance is a property of the gesture rather than of the
 * clock: a 2px jitter never accumulates it, and a deliberate move always does.
 *
 * **Why nothing here reads a BLOCK's size.** The obvious alternative is to
 * require a target to be some minimum height before it can be claimed, which is
 * what a survey of the field suggests. It cannot work in this editor. A
 * `core/spacer`'s height is an author-set prop with no lower bound and a divider
 * is a single pixel, so any absolute floor makes some authored block impossible
 * to drop beside. Keying on the GAP between blocks moves the same hazard rather
 * than removing it, because two blocks with no margin have a gap of zero. This
 * rule reads two points and a number, so a 1px divider, a 0px spacer, a 900px
 * hero, a vertical stack and a grid all behave identically.
 *
 * The functions are pure and take plain points, so the behaviour is exercised
 * without a browser and the pointer reads stay at the edge.
 *
 * @module target-switch
 */
import type { Point } from "./geometry";

/**
 * A drop target's identity, or `null` for "the pointer is over none".
 *
 * `null` is an ordinary value here rather than an absence: losing a target at a
 * boundary flickers exactly as gaining the wrong one does, so dropping the
 * committed target is held to the same threshold as replacing it.
 */
export type TargetId = string | null;

/**
 * A candidate that has appeared but not yet earned the switch.
 *
 * `anchor` is where the pointer was when this candidate FIRST differed from the
 * committed target, which is the subtlety the whole rule turns on. See
 * {@link nextTargetSwitchState}.
 */
export interface PendingTarget {
  readonly target: TargetId;
  readonly anchor: Point;
}

/** What the rule remembers between pointer moves. */
export interface TargetSwitchState {
  /** The target actually in effect — what the indicator draws and a drop uses. */
  readonly committed: TargetId;
  /** A rival waiting to earn the switch, or `null` when none is waiting. */
  readonly pending: PendingTarget | null;
}

/** A drag that has not yet resolved a target. */
export const NO_TARGET: TargetSwitchState = {
  committed: null,
  pending: null,
};

/** Straight-line distance between two points. */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Advances the rule by one pointer move.
 *
 * @param state - what the previous move left behind; {@link NO_TARGET} to begin
 * @param candidate - the target the collision engine resolves at `pointer` now
 * @param pointer - the pointer, in any one coordinate space used consistently
 * @param thresholdPx - how far the pointer must travel for a rival to win
 * @returns the next state; `committed` is what the editor should act on
 *
 * @throws RangeError if `thresholdPx` is negative or not finite. A threshold is
 * a contract rather than a hint, and a `NaN` arriving from an unparsed
 * configuration value would make every comparison false and silently disable the
 * rule — a flickering canvas with nothing to point at.
 *
 * @remarks
 * **The anchor is where the candidate CHANGED, not where the last switch
 * happened, and the difference is the whole mechanism.**
 *
 * Measuring from the last switch reads plausibly and gives no hysteresis at all
 * in the commonest case. An author dragging from the block library crosses most
 * of the page before reaching the seam between two blocks: by the time they
 * arrive, the distance since the last switch is already far past any threshold,
 * so the first pixel over the boundary switches immediately and the jitter that
 * follows switches back just as fast. The rule would be satisfied and absent
 * exactly where it is needed.
 *
 * Anchoring at the moment the candidate first differs makes the threshold
 * measure the crossing itself, so it costs the same and applies wherever the
 * crossing happens.
 *
 * **Displacement, not path length.** A pointer jittering back and forth across a
 * seam accumulates unbounded path length while never getting anywhere, so a path
 * measure would eventually grant the switch it exists to withhold. Distance from
 * the anchor cannot be accumulated by going nowhere.
 *
 * **The first target commits immediately.** There is nothing to flicker between
 * before a target exists, and withholding it would leave a drag with no
 * indicator until the pointer had travelled the threshold, which reads as the
 * canvas failing to respond.
 */
export function nextTargetSwitchState(
  state: TargetSwitchState,
  candidate: TargetId,
  pointer: Point,
  thresholdPx: number
): TargetSwitchState {
  if (!Number.isFinite(thresholdPx) || thresholdPx < 0) {
    throw new RangeError(
      `target switch threshold must be a finite, non-negative number of pixels, received ${String(thresholdPx)}`
    );
  }

  // Agreement clears any rival: a candidate that has gone back to matching what
  // is committed is no longer waiting for anything, and leaving it pending would
  // let a later return to that same value inherit a stale anchor and switch on a
  // crossing it never made.
  if (candidate === state.committed) {
    return state.pending === null ? state : { ...state, pending: null };
  }

  // Nothing is committed yet, so there is no incumbent to protect.
  if (state.committed === null) {
    return { committed: candidate, pending: null };
  }

  // A different rival from the one that was waiting restarts the measurement,
  // because the distance travelled while some OTHER target was pending says
  // nothing about how far the pointer has moved since this one appeared.
  //
  // Established and then MEASURED in the same move rather than returned early.
  // A new rival is zero pixels from its own anchor, so the check below rejects
  // it for any positive threshold exactly as an early return would — and a
  // threshold of zero, which is a legitimate request for no hysteresis, switches
  // at once instead of carrying a one-move delay nothing asked for.
  const pending =
    state.pending !== null && state.pending.target === candidate
      ? state.pending
      : { target: candidate, anchor: pointer };

  if (distance(pointer, pending.anchor) < thresholdPx) {
    return state.pending === pending ? state : { ...state, pending };
  }

  // Earned. The rival becomes the incumbent and the next crossing is measured
  // from wherever it happens rather than from here.
  return { committed: candidate, pending: null };
}
