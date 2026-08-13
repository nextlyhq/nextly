/**
 * The vocabulary the canvas acceptance suite speaks. Implementations swap; the
 * suite does not. A behaviour that cannot be expressed here is out of scope for
 * the suite.
 */
export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A seeded page: the entry to open, and the node ids it contains in order. */
export interface CanvasFixture {
  entryId: string;
  blockIds: string[];
}

/** One observed change of the active drop target. */
export interface ActiveTargetTransition {
  /** Milliseconds since recording started. */
  at: number;
  /**
   * Ordinal of the target that became active, or -1 when none did — the same
   * numbering {@link CanvasDriver.readActiveTarget} returns.
   */
  index: number;
}

/**
 * Stops a recording and returns what it saw, oldest first.
 *
 * The first entry is the state when recording began, so a log of length one
 * means nothing changed.
 */
export type ActiveTargetReader = () => Promise<ActiveTargetTransition[]>;

/**
 * A block's position and size inside the canvas, in canvas-local pixels.
 *
 * Unrounded. A caller comparing two snapshots for equality is asking whether
 * anything moved, and rounding answers a different question — whether anything
 * moved by at least half a pixel.
 */
export interface BlockBox {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface CanvasDriver {
  /** Open the canvas on a seeded page and wait until it is interactive. */
  mountTree(fixture: CanvasFixture): Promise<void>;

  /**
   * Centre of a draggable source in the insert panel, in host coordinates.
   *
   * On the driver rather than in the suite because "where a drag starts" is the
   * single most implementation-specific fact about a canvas: the PoC has a
   * library list, v2 has a three-tier inserter. A suite that located it itself
   * could not be retargeted by swapping the driver.
   */
  dragSourceCentre(): Promise<Point>;

  /** A point over the canvas, near its top, in host coordinates. */
  canvasCentre(): Promise<Point>;

  /**
   * Insert a block without dragging: the non-drag path WCAG 2.2 §2.5.7 requires
   * for every drag gesture. On the driver because how it is offered is a canvas
   * decision, while "it must exist" is a requirement of every canvas.
   */
  clickToInsert(): Promise<void>;

  /** Where the pointer was last commanded to, in host coordinates. */
  pointer(): Point;

  /**
   * Whether a drag is currently in flight.
   *
   * Distinguishes "no drag started" from "a drag started and mutated nothing",
   * which a tree-shape check alone cannot tell apart.
   */
  isDragging(): Promise<boolean>;

  /** The canvas frame's top-left in host coordinates. */
  frameOrigin(): Promise<Point>;

  /**
   * The canvas frame's current transform scale, 1 when untransformed.
   *
   * Exposed so a scenario can prove the zoom it asked for was actually
   * applied: a `setZoom` that silently stopped working would otherwise let a
   * scaled test degrade into an unscaled one and still pass.
   */
  frameScale(): Promise<number>;

  /**
   * Whether the editor is still mounted.
   *
   * On the driver because what "the editor" is made of differs per canvas;
   * asking for one canvas's chrome class directly would report a correctly
   * behaving replacement as broken.
   */
  isEditorPresent(): Promise<boolean>;

  /** Press the pointer at a top-level viewport point and pass the drag threshold. */
  /**
   * Press Escape and nothing else.
   *
   * Separate from {@link CanvasDriver.cancel}, which releases the pointer
   * immediately afterwards: a test that reads drag state through `cancel`
   * cannot distinguish Escape ending the drag from the mouse-up ending it, so a
   * canvas with a dead Escape handler satisfies it.
   */
  pressEscape(): Promise<void>;

  startDragAt(point: Point): Promise<void>;
  /**
   * Press the pointer WITHOUT passing the drag threshold.
   *
   * Separate from {@link CanvasDriver.startDragAt}, which moves past the
   * threshold by contract — so a test asserting that a small movement does not
   * drag cannot use it, because the drag has already begun. Each canvas knows
   * its own threshold, which is why this is a driver method rather than the
   * suite pressing and moving a number it chose.
   */
  pressAt(point: Point): Promise<void>;
  /** Move the pointer by a delta, in one step. */
  moveBy(dx: number, dy: number): Promise<void>;
  drop(): Promise<void>;
  cancel(): Promise<void>;

  /** Move the pending insertion point with the keyboard. */
  keyboardInsert(direction: "up" | "down"): Promise<void>;

  /**
   * Ordinal of the active drop zone among ALL drop zones in document order, or
   * -1 when none is active. Ordinal rather than id because the droppable id is
   * not present in the DOM.
   */
  readActiveTarget(): Promise<number>;

  /**
   * Start recording every change of the active drop target inside the page,
   * and return the reader that stops recording and hands back the log.
   *
   * Sampling with {@link CanvasDriver.readActiveTarget} cannot answer a
   * question about hysteresis. Each sample is a round trip out of the browser,
   * so the pointer rests wherever it was left for as long as that trip takes;
   * a canvas whose hysteresis is a dwell timer rather than a distance margin is
   * then entitled to commit to the new target before the next move arrives, and
   * the probe reports a flip that the gesture never provoked. Observing from
   * inside the page separates what is measured from what is driven, and it also
   * catches transitions that fall between two samples.
   */
  recordActiveTargetTransitions(): Promise<ActiveTargetReader>;
  /** Bounding box of the visible insertion indicator, in top-level coordinates. */
  readIndicatorRect(): Promise<Rect | null>;
  /**
   * Node ids in document order, root first. Shape assertions after a drop read
   * this. Ids rather than block types because the canvas emits `data-nx-id` and
   * no type attribute, and identity answers more questions than type does: a
   * reorder is visible in the ids and invisible in a list of types.
   */
  readTreeShape(): Promise<string[]>;

  /** Every block's box in canvas-local pixels, document order, root first. */
  readBlockBoxes(): Promise<BlockBox[]>;

  /** Every drop zone's height in canvas-local pixels, document order. */
  readZoneHeights(): Promise<number[]>;

  /**
   * Ordinal of the drop zone whose mapped rect CONTAINS the current pointer, or
   * -1 when the pointer is inside none of them.
   *
   * The exact form of "the indicator is where the pointer is", and it needs no
   * tolerance. A zone containing the pointer is the one dnd-kit's default
   * detector resolves to, so a canvas that answers with any other zone has
   * mapped the pointer wrongly — which is what both the stale-rect (#1705) and
   * unscaled-transform (#1706) failures do.
   *
   * Containment rather than proximity, because proximity is not a rule this
   * canvas follows. `@dnd-kit/collision` ranks a containing zone by pointer
   * intersection FIRST and only falls back to the dragged shape's overlap when
   * no zone contains the pointer, so the nearest zone by centre distance and
   * the resolved zone legitimately differ next to a boundary.
   */
  zoneContainingPointer(): Promise<number>;

  /**
   * Ordinal of the drop zone geometrically nearest the current pointer.
   *
   * The APPROXIMATE reading, and the weaker of the two. Proximity is not a rule
   * this canvas follows: `@dnd-kit/collision` resolves to a zone CONTAINING the
   * pointer first and only ranks by the dragged shape's overlap when none does,
   * so next to a boundary the nearest zone by centre distance and the resolved
   * zone legitimately differ. Measured, one sample of 28 resolved one ordinal
   * away with the pointer inside neither.
   *
   * So an equality assertion against this is a latent flake wherever the pointer
   * may sit outside every zone. Use {@link zoneContainingPointer} for the exact
   * claim, and bound this one to a single ordinal where only an approximation is
   * available.
   */
  nearestZoneToPointer(): Promise<number>;

  /** `data-nx-id` of the container owning the active zone, or null. */
  readActiveZoneOwner(): Promise<string | null>;

  /** Scroll the HOST document (not the canvas) during a drag. */
  scrollHost(dy: number): Promise<void>;
  /** Apply a CSS transform scale to the canvas frame. */
  setZoom(scale: number): Promise<void>;
}

/**
 * A reader a canvas cannot answer, because of how it is built rather than
 * because it is broken.
 *
 * The PoC draws its insertion indicator INSIDE the iframe with CSS; the v2
 * canvas must draw it in host chrome. A driver for the first cannot report
 * where a host overlay is, and pretending otherwise would make an acceptance
 * test pass on a canvas that does not meet the requirement.
 *
 * Thrown with the reason named, so an expected failure records WHY the canvas
 * falls short. A test that fails because the page never loaded and one that
 * fails because the canvas genuinely lacks the property are the same colour;
 * only the message separates them, and a target nobody can read is a target
 * that silently stops being one.
 */
export class CanvasCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasCapabilityError";
  }
}

/**
 * Readers the twelve-point acceptance suite needs beyond a drag.
 *
 * Separate from {@link CanvasDriver} because these describe the canvas's
 * CHROME rather than its drag mechanics, and because every one of them is a
 * property the v2 canvas must have and the PoC need not. A driver that cannot
 * answer throws {@link CanvasCapabilityError} rather than guessing.
 */
export interface CanvasChromeReader {
  /**
   * How many insertion-indicator elements exist, and whether they live in the
   * host document or inside the canvas frame.
   *
   * Both halves in one reader because the requirement is one claim: exactly one
   * indicator, drawn in parent chrome. Asking them separately invites a canvas
   * that satisfies each and neither together — one host indicator plus a
   * leftover inside the frame answers "one" to a host-scoped count.
   */
  readIndicators(): Promise<{ count: number; host: "document" | "frame" }>;

  /**
   * Whether the canvas is showing an explicit invalid-drop state.
   *
   * A canvas that simply shows nothing over an illegal target is
   * indistinguishable from one that has not decided yet, and the author cannot
   * tell "you may not drop here" from "the drag broke".
   */
  readsInvalidTarget(): Promise<boolean>;

  /** Scroll offset inside the canvas frame, for autoscroll assertions. */
  canvasScrollTop(): Promise<number>;

  /** Begin dragging a block that is already in the canvas, by its id. */
  startDragOfBlock(id: string): Promise<void>;

  /** How many entries the editor's undo history holds. */
  undoDepth(): Promise<number>;
}

/**
 * Carries a drag forward until a drop zone is actually active, or gives up.
 *
 * Arriving over the canvas is NOT the same as being over a zone, and the
 * difference is the whole reason this exists. A canvas separates its zones with
 * block-sized dead space, so a pointer walked to the geometric centre routinely
 * lands where nothing is active — `readActiveTarget` answers `-1`, and a test
 * that reads a target there is measuring dead space while its title claims
 * otherwise.
 *
 * Two failures come out of that, and neither looks like a missing precondition.
 * A test comparing the active zone against the nearest one fails with `-1`
 * against a real index, which reads as a collision-resolution defect. A test
 * jittering the pointer counts the indicator vanishing and returning as target
 * changes, which reads as missing hysteresis. Both are the harness standing in
 * the wrong place.
 *
 * Returns the active zone's index, or `-1` when the whole descent found none —
 * a value the CALLER must assert on, because continuing from `-1` is exactly
 * the measurement this prevents.
 */
export async function dragUntilTarget(
  driver: CanvasDriver,
  maxSteps = 90
): Promise<number> {
  for (let step = 0; step < maxSteps; step += 1) {
    await driver.moveBy(0, 8);
    const active = await driver.readActiveTarget();
    if (active >= 0) return active;
  }
  return -1;
}

/** Where a boundary search left the pointer. */
export interface ZoneEdge {
  /** Active target the pointer rests on, or -1 when no boundary was reached. */
  readonly target: number;
  /**
   * Whether an edge was found and the pointer stepped back just inside it.
   *
   * `false` is not a failure. The search runs a bounded distance, and a target
   * that does not change within it is a STICKY one — which is the behaviour the
   * jitter requirement asks for. A caller may still jitter from there and
   * observe no flip; it simply has weaker evidence, because the pointer is not
   * known to straddle an edge.
   */
  readonly bracketed: boolean;
}

/**
 * Carries the drag to a zone BOUNDARY and leaves the pointer one pixel inside it.
 *
 * A jitter is only a test of hysteresis when it straddles an edge. Oscillating
 * in the middle of a zone's catchment reports a stable target on a canvas with
 * no hysteresis at all, because nothing there was ever close to switching — the
 * assertion is satisfied by the pointer being far from any decision.
 *
 * Three steps, and each one is load-bearing:
 *
 * 1. Reach a zone, so the walk starts from a live target rather than dead
 *    space, where the indicator appearing and vanishing counts as a change.
 * 2. Walk until the target CHANGES, which is the only way to know an edge was
 *    passed rather than assumed.
 * 3. Step back a pixel at a time until it changes again, then one step in. The
 *    pointer is now within a pixel of the edge, so +/-2px lands on opposite
 *    sides of it.
 *
 * The search distance is deliberately past the largest margin the requirement
 * allows, so failing to find the edge means the target is sticky rather than
 * that the search was too short.
 *
 * Shared rather than repeated because the acceptance suite and the scenario
 * suite ask the same question, and a per-suite copy is invisible when it is
 * wrong: the drag still runs and still reports a number.
 */
export async function dragToZoneEdge(
  driver: CanvasDriver,
  searchPx = 24
): Promise<ZoneEdge> {
  const first = await dragUntilTarget(driver);
  if (first < 0) return { target: -1, bracketed: false };

  let crossed = -1;
  let previous = first;
  for (let step = 0; step < 120; step += 1) {
    await driver.moveBy(0, 4);
    const current = await driver.readActiveTarget();
    if (current >= 0 && current !== previous) {
      crossed = current;
      break;
    }
    if (current >= 0) previous = current;
  }
  if (crossed < 0) return { target: previous, bracketed: false };

  for (let step = 0; step < searchPx; step += 1) {
    await driver.moveBy(0, -1);
    if ((await driver.readActiveTarget()) !== crossed) {
      await driver.moveBy(0, 1);
      return { target: crossed, bracketed: true };
    }
  }
  return { target: crossed, bracketed: false };
}

/**
 * Oscillate the pointer across the edge the caller has just bracketed.
 *
 * Steps to P-2 FIRST and then alternates by 4, so the samples are P-2 and P+2 —
 * genuinely opposite sides. Alternating +/-2 from P samples P+2 and P, both on
 * the same side, and a canvas that switches the instant the pointer crosses
 * passes that.
 */
export async function jitterAcrossEdge(
  driver: CanvasDriver,
  cycles = 6
): Promise<void> {
  await driver.moveBy(0, -2);
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    await driver.moveBy(0, 4);
    await driver.moveBy(0, -4);
  }
}

/**
 * Carries a panel drag to a point, measuring from where the pointer ACTUALLY is.
 *
 * `startDragAt` is contractually allowed to move past the drag activation
 * threshold, and the PoC driver shifts 12px doing so. A delta computed from the
 * SOURCE point therefore overshoots by exactly that, and a replacement driver
 * with different activation motion overshoots by a different amount — which
 * defeats the seam this suite exists to keep swappable.
 *
 * Shared rather than repeated, so every suite measures the delta the same way.
 * A per-suite copy of this arithmetic is invisible when it is wrong: the drag
 * still runs and still ends somewhere plausible, and only the distance is off.
 *
 * In steps rather than one jump, because a single move is a teleport and a
 * canvas that commits on dwell answers a teleport differently from a gesture.
 */
export async function dragPointerTo(
  driver: CanvasDriver,
  target: Point,
  steps = 8
): Promise<void> {
  // A precondition, not a clamp. Zero or fewer steps runs no move at all, so
  // the helper resolves with the pointer where it started and the caller's next
  // assertion reports a canvas fault for a gesture that never happened. A
  // fractional count leaves the pointer short of the target for the same
  // reason, with nothing to distinguish it from a canvas that ignored the move.
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error(
      `dragPointerTo needs a whole number of steps, at least 1; got ${String(steps)}`
    );
  }
  const from = driver.pointer();
  for (let step = 0; step < steps; step += 1) {
    await driver.moveBy(
      (target.x - from.x) / steps,
      (target.y - from.y) / steps
    );
  }
}
