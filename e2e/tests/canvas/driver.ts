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
   * The longest this canvas may keep showing a previous reading after the
   * pointer has moved, in milliseconds.
   *
   * Declared per driver because the requirement permits a dwell of MORE than
   * 100ms and sets no upper bound, so no global constant is correct for every
   * canvas. A canvas with a distance margin rather than a timer declares 0.
   *
   * Optional: a driver that omits it gets {@link DEFAULT_DWELL_ALLOWANCE_MS}.
   * Understating it is self-punishing rather than self-serving — readings come
   * back stale and this suite fails — which is why the settling helpers trust
   * it while the jitter probe, which grades whether hysteresis exists at all,
   * deliberately does not.
   */
  dwellAllowanceMs?: number;

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

  /**
   * Carry an already-pressed pointer past THIS canvas's activation threshold.
   *
   * The distance is the driver's to know. `startDragAt` is contractually
   * allowed to move by whatever its canvas requires, so a suite that hard-codes
   * a displacement is asserting one canvas's threshold on every other: a
   * replacement whose activation distance is larger leaves the press below
   * threshold, and a positive control built on it fails while reporting a
   * property that is perfectly satisfied.
   *
   * Used to prove a press is LIVE. A sub-threshold test reads "not dragging",
   * which absence satisfies just as well as correct hysteresis does.
   */
  crossActivationThreshold(): Promise<void>;

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
  driver: EdgeSearchDriver,
  maxSteps = 90
): Promise<number> {
  for (let step = 0; step < maxSteps; step += 1) {
    await driver.moveBy(0, 8);
    // Given the dwell, not sampled. A resolver whose hysteresis is a timer
    // starting from no target at all can have that timer RESET by each move,
    // so a fixture of narrow candidates is traversed for every step without a
    // target ever becoming active — and both hysteresis suites then fail their
    // precondition before reaching the dwell-aware search they exist to run.
    const active = await departureFrom(
      () => driver.readActiveTarget(),
      -1,
      dwellAllowanceOf(driver)
    );
    if (active >= 0) return active;
  }
  return -1;
}

/**
 * The longest dwell a canvas may use INSTEAD of a distance margin.
 *
 * The requirement permits hysteresis expressed either way, so a compliant
 * canvas is allowed to keep showing the previous target for this long after the
 * pointer has moved. Every reader that asks "which target is active" therefore
 * has to decide whether it is reading a settled answer or a permitted lag.
 */
export const PERMITTED_DWELL_FLOOR_MS = 100;

/**
 * The longest dwell this suite will WAIT for before calling a reading settled.
 *
 * Separate from {@link PERMITTED_DWELL_FLOOR_MS} because the two answer
 * opposite questions, and one number cannot serve both:
 *
 * - Settling asks "has the canvas committed yet?", so it must wait at least as
 *   long as the longest dwell a compliant canvas may use. Too SMALL and a
 *   compliant slow canvas is read while still lagging.
 * - The jitter probe asks "was that move fast enough that a compliant timer
 *   could NOT have committed?", so its bound must be no larger than the
 *   SHORTEST permitted dwell. Too LARGE and it accepts a sweep during which a
 *   compliant canvas legitimately switched, then reads that switch as missing
 *   hysteresis.
 *
 * One constant cannot serve both: any value large enough for the first is too
 * large for the second, and any value small enough for the second is too small
 * for the first.
 *
 * The requirement states a dwell of MORE than 100ms and gives no upper bound,
 * so no finite wait is provably sufficient and no global constant can be
 * correct for every canvas. This is the DEFAULT for a driver that does not say
 * otherwise; a canvas that dwells longer declares it on the driver, the way the
 * activation threshold already is.
 *
 * Which number each question uses is the load-bearing part. Settling takes the
 * DRIVER's figure, because that is harness-side knowledge about the
 * implementation and getting it wrong is self-punishing — understate it and
 * readings come back stale and the suite fails. The jitter probe takes the
 * REQUIREMENT's floor instead, never the driver's, because it grades whether
 * hysteresis exists at all: feeding it the canvas's own claim would let an
 * implementation set the bar it is measured against.
 */
export const DEFAULT_DWELL_ALLOWANCE_MS = 3 * PERMITTED_DWELL_FLOOR_MS;

/**
 * How many times a stationary pointer may see the reading change before it is
 * called unsettled.
 *
 * A canvas is entitled to one change, and to another if the first expiry moved
 * the target somewhere that starts a second; past a few it is changing its mind
 * with no input to justify it, which is a defect rather than permitted lag and
 * must not be reported as a settled reading.
 */
const SETTLE_TRANSITIONS = 4;

/** The capability these readers need, so a test can supply exactly it. */
type TargetReader = Pick<CanvasDriver, "readActiveTarget"> &
  Partial<Pick<CanvasDriver, "dwellAllowanceMs">>;

/**
 * What an edge search needs, which is less than a whole canvas.
 *
 * Declared as the capability rather than the whole interface so these searches
 * can run against a simulated resolver as well as a real canvas. Their waiting
 * behaviour is only observable against a canvas that declares a dwell, and the
 * canvas this suite drives declares none.
 */
type EdgeSearchDriver = Pick<CanvasDriver, "moveBy" | "readActiveTarget"> &
  Partial<Pick<CanvasDriver, "dwellAllowanceMs">>;

/** {@link EdgeSearchDriver} plus the in-page recorder the jitter probe needs. */
type JitterDriver = EdgeSearchDriver &
  Pick<CanvasDriver, "recordActiveTargetTransitions">;

/**
 * Wait for `read` to return something other than `from`, or for the permitted
 * dwell to pass.
 *
 * The one waiting loop in this file, because the two questions callers ask —
 * "has it moved off X yet" and "what is it once it stops moving" — differ only
 * in what they do with the answer, and two loops would drift.
 *
 * Returns the departed value, or `from` when the whole allowance passed without
 * one. A caller can therefore distinguish the two by comparing with what it
 * passed in, and "unchanged" now MEANS unchanged for the full permitted dwell
 * rather than unchanged between two adjacent reads.
 *
 * Generic over the reading, because the dwell is a property of the CANVAS
 * rather than of any one probe: the active target, the owning zone and anything
 * else read straight after a move are all entitled to the same lag, and a
 * version that only knew about target ordinals would leave the other readers to
 * grow their own copy of this.
 */
async function departureFrom<T>(
  read: () => Promise<T>,
  from: T,
  allowanceMs: number
): Promise<T> {
  const deadline = Date.now() + allowanceMs;
  let current = await read();
  while (current === from && Date.now() < deadline) {
    current = await read();
  }
  // One reading taken strictly AFTER the deadline before concluding it never
  // departed. Every read above may have SAMPLED the value before the deadline
  // and resolved after it — a cross-frame read easily spans that boundary — so
  // the loop can exit holding a value that was already stale when it was taken,
  // and report a canvas that committed exactly on time as never having moved.
  if (current === from) current = await read();
  return current;
}

/**
 * Read what a canvas has COMMITTED to, rather than what it is still entitled to
 * be showing.
 *
 * A canvas whose hysteresis is a TIMER rather than a distance margin is allowed
 * to lag: the pointer is over a new zone and the old reading stays correct for
 * up to the dwell its driver declares. So "settled" cannot mean "two reads agreed"
 * — during that lag EVERY read agrees, and they all return the pre-move value.
 * Stability is only evidence once it has been observed across the whole interval
 * the canvas was permitted to lag for, which is why this waits the allowance out
 * rather than stopping at the first identical pair.
 *
 * Throws rather than returning when the reading never holds still: a value from
 * a canvas that is still changing its mind is one no assertion downstream can
 * qualify, and handing it back silently would let an unstable canvas produce an
 * ordinary-looking green.
 */
export async function settledValue<T>(
  read: () => Promise<T>,
  allowanceMs: number,
  subject = "reading"
): Promise<T> {
  let value = await read();
  // Bounded by TRANSITIONS, never by a clock. What is being tolerated is a
  // canvas changing its mind a bounded number of times, and each observation
  // already bounds its own wait by the allowance — so a wall-clock budget adds
  // nothing and collapses to zero for a canvas that declares no dwell, where it
  // would turn a single asynchronous re-render between two reads into a harness
  // error instead of a settled reading.
  //
  // The count is of CHANGES, so the permitted number of them is followed by one
  // more observation rather than ending on one. Ending on a transition would
  // reject a reader that changed exactly the permitted number of times and then
  // held perfectly still — asynchronous relayout does precisely that — and the
  // refusal would land on the reading that finally settled.
  for (let transition = 0; transition <= SETTLE_TRANSITIONS; transition += 1) {
    const next = await departureFrom(read, value, allowanceMs);
    if (next === value) return value;
    value = next;
  }
  throw new Error(
    `the ${subject} changed more than ${String(SETTLE_TRANSITIONS)} times with ` +
      `a stationary pointer (last seen ${String(value)}), so nothing read here ` +
      `is settled`
  );
}

/** {@link settledValue} over the active drop target, at the driver's own dwell. */
export async function settledTarget(driver: TargetReader): Promise<number> {
  return settledValue(
    () => driver.readActiveTarget(),
    dwellAllowanceOf(driver),
    "active target"
  );
}

/**
 * The dwell a driver declares, or the default when it declares none.
 *
 * The field is optional, so a driver that declares nothing still has an
 * allowance; read through one helper so that fallback is stated once rather
 * than at each call, where the several copies would drift.
 */
export function dwellAllowanceOf(driver: Partial<CanvasDriver>): number {
  return driver.dwellAllowanceMs ?? DEFAULT_DWELL_ALLOWANCE_MS;
}

/**
 * Carry the drag until the pointer is INSIDE a zone, not merely until one is
 * active.
 *
 * `dragUntilTarget` stops as soon as a target resolves, and
 * `@dnd-kit/collision` resolves one by the dragged shape's OVERLAP when no zone
 * contains the pointer. So "a target is active" and "the pointer is inside that
 * target" are different states, and every exact claim about mapping — is the
 * indicator where the pointer is, do two drags resolve the same way — is only
 * decidable in the second.
 *
 * The distinction is not academic: it is where a stale-scroll or unscaled
 * transform hides. Those implementations select a NEIGHBOURING zone, which any
 * assertion tolerant of the overlap case accepts.
 *
 * Returns the containing zone's ordinal, or -1 if none was reached — a value the
 * CALLER must assert on, for the same reason `dragUntilTarget` says so.
 */
/**
 * What placing the pointer at a known depth needs, which is less than a whole
 * canvas.
 *
 * `pointer()` is what makes the result a MEASUREMENT rather than an intention:
 * the inset is reported in pixels of pointer movement, which is the only unit
 * an assertion about a hysteresis band can be written in. A collision score
 * cannot serve — `Collision.value` is pointer distance for one collision type
 * and overlap area for another, so the same number means different things per
 * candidate kind.
 */
type ZoneInsetDriver = Pick<
  CanvasDriver,
  "moveBy" | "zoneContainingPointer" | "pointer"
>;

/** What the coarse approach observed, which is more than the zone it reached. */
interface ZoneApproach {
  /** The zone containing the pointer, or -1 when none was reached. */
  readonly zone: number;
  /** Pixels travelled to reach it — 0 when the pointer was already inside. */
  readonly travelledPx: number;
}

/**
 * Step until some zone contains the pointer, reporting how far that took.
 *
 * The one coarse walk, because two of them drift: the step size and the
 * termination rule are the same question asked by `dragUntilInsideZone` and by
 * the exact-depth probe, and a change to either in one place would silently
 * make the two disagree while both still returned a number.
 *
 * `travelledPx` is what the second caller needs and the first ignores. It bounds
 * where the boundary can be — having walked in, the edge is at most this far
 * back — which is how a retreat gets a limit derived from observation rather
 * than from a constant.
 */
async function approachZone(
  driver: Pick<CanvasDriver, "moveBy" | "zoneContainingPointer" | "pointer">,
  maxSteps: number
): Promise<ZoneApproach> {
  const startedAt = driver.pointer().y;
  let zone = await driver.zoneContainingPointer();
  for (let step = 0; step < maxSteps && zone < 0; step += 1) {
    await driver.moveBy(0, INSET_APPROACH_PX);
    zone = await driver.zoneContainingPointer();
  }
  return { zone, travelledPx: driver.pointer().y - startedAt };
}

/** Where {@link dragToInsetInZone} left the pointer, and how it knows. */
export interface ZoneInset {
  /** The zone the pointer ended inside, or -1 when none was reached. */
  readonly zone: number;
  /**
   * Pixels of pointer movement PAST the boundary, measured rather than assumed.
   *
   * Present only when a boundary was actually found: the pointer is INSIDE
   * `zone` at this depth, including under `too-narrow`. ABSENT for the refusals
   * that never located an edge, because there is no boundary for a depth to be
   * measured from and a `0` there would read as "at the boundary" — a position
   * the pointer is not standing at.
   */
  readonly insetPx?: number;
  /**
   * How precisely the boundary itself is known, in pixels.
   *
   * A zone edge comes from `getBoundingClientRect()` and is fractional; the
   * pointer is commanded in whole probe steps. So the boundary this measures
   * from is the first COMMANDED position inside the zone, which can sit up to
   * one step past the real edge, and `insetPx` carries that error.
   *
   * Reported rather than hidden, because a caller comparing a measured band
   * against a required range has to widen its bounds by exactly this much. The
   * alternative — resolving the fractional edge — is not available to a probe
   * that can only command whole pixels.
   */
  readonly resolutionPx: number;
  /**
   * Why a request could not be met, absent when it was.
   *
   * Three distinct facts, because a caller reports them differently:
   * `never-entered` is about the canvas drawing no zone in reach;
   * `too-narrow` is about the FIXTURE, and comes with the deepest depth the
   * zone does hold, so a caller can say what it would need; and
   * `boundary-not-found` is about this probe, which cannot locate an edge it
   * did not cross — a drag already deep inside a tall zone has no boundary in
   * retreat range, and saying "no zone" there would be false; and `edge-moving`
   * is about the canvas relaying out underneath the measurement, where a depth
   * would be a number with no referent.
   */
  readonly refused?:
    | "never-entered"
    | "too-narrow"
    | "boundary-not-found"
    | "edge-moving";
}

/** Pixels per step while closing on the boundary, once the zone has been found. */
const INSET_PROBE_PX = 1;

/** Pixels per step while approaching, before any zone has been reached. */
const INSET_APPROACH_PX = 4;

/** How many times the boundary may be re-measured before its motion is a verdict. */
const EDGE_SETTLE_ATTEMPTS = 3;

/**
 * The longest a zone edge may still be moving after the pointer enters it.
 *
 * The canvas animates a drop zone's height and margin over 100ms when it becomes
 * the active target, and an animation is CONTINUOUS: two brackets taken back to
 * back can quantize to the same whole pixel while the edge is still travelling
 * inside it. Agreement between adjacent samples is therefore necessary and not
 * sufficient, and no purely positional method can close that — "has an animation
 * finished" is a question about an interval.
 *
 * So this is a clock, deliberately, and it is the canvas's own transition
 * duration rather than a guess. Paired with the agreement check: the wait covers
 * the animation, the agreement confirms it is over.
 */
const EDGE_SETTLE_MS = 120;

/** One wait, named for what it is, so no caller invents its own. */
function settleMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * The first pointer position INSIDE `zone`, and the NET distance this moved to find it.
 *
 * Two directions, because a zone edge moves both ways. The pointer may start
 * inside — the ordinary case, where the edge is somewhere above — or OUTSIDE,
 * which is what the canvas produces when a drop zone takes its 4px active margin
 * in place of the 3px drag one: the top edge travels DOWN, and a pointer resting
 * on the old boundary is left above the new one. Retreating from there only ever
 * moves further away, so a walk that assumed "inside" would report an edge it
 * was standing a pixel short of as unfindable.
 *
 * Returns `null` when no edge is within `limitPx` in either direction, and
 * restores the pointer before doing so: a measurement that could not be taken
 * must not also move the drag.
 *
 * `movedPx` is signed and NET — positive is downward — so one caller can undo
 * the whole excursion without tracking its parts.
 */
async function bracketZoneEdge(
  driver: ZoneInsetDriver,
  zone: number,
  limitPx: number
): Promise<{ boundaryY: number; movedPx: number } | null> {
  let moved = 0;
  const restore = async (): Promise<null> => {
    await driver.moveBy(0, -moved);
    return null;
  };

  // Forward until the zone is re-entered, for the case where its edge moved out
  // from under the pointer.
  let advanced = 0;
  while (
    (await driver.zoneContainingPointer()) !== zone &&
    advanced < limitPx
  ) {
    await driver.moveBy(0, INSET_PROBE_PX);
    moved += INSET_PROBE_PX;
    advanced += INSET_PROBE_PX;
  }
  if ((await driver.zoneContainingPointer()) !== zone) return restore();

  // Back out a pixel at a time until the zone is left.
  let retreated = 0;
  let left = false;
  while (retreated < limitPx) {
    await driver.moveBy(0, -INSET_PROBE_PX);
    moved -= INSET_PROBE_PX;
    retreated += INSET_PROBE_PX;
    if ((await driver.zoneContainingPointer()) !== zone) {
      left = true;
      break;
    }
  }
  if (!left) return restore();

  // One step back in: the pointer is within a step of the boundary, and this
  // position — not a step count — is what the depth is measured from.
  await driver.moveBy(0, INSET_PROBE_PX);
  moved += INSET_PROBE_PX;
  if ((await driver.zoneContainingPointer()) !== zone) return restore();
  return { boundaryY: driver.pointer().y, movedPx: moved };
}

/**
 * Carry the drag to EXACTLY `wantInsetPx` inside the zone it first enters.
 *
 * {@link dragUntilInsideZone} stops at the first coarse step that lands inside
 * a zone, so where it leaves the pointer is an accident of the step size and no
 * caller can say how deep it is. That is fine for a containment question and
 * useless for a hysteresis one: a canvas whose hysteresis is a distance margin
 * has correctly NOT switched a few pixels past a boundary, because that is
 * inside its margin and holding the previous target there is what the
 * requirement asks for. Waiting cannot rescue it — waiting does not move a
 * pointer, and a distance-based resolver does not change its mind with time.
 * The only way to ask such a canvas a question is to stand at a KNOWN depth.
 *
 * Three phases, and the middle one is what makes the answer exact:
 *
 * 1. coarse steps until some zone contains the pointer, REMEMBERING how far it
 *    travelled — that distance bounds where the boundary can be, so the retreat
 *    below is derived from observed geometry rather than from a fixed budget;
 * 2. one-pixel steps BACK until the zone is left, then one forward — the
 *    boundary is now bracketed to within a step and its position is read from
 *    the driver rather than inferred from a step count;
 * 3. forward to the requested depth, re-reading containment so a zone too
 *    shallow to hold it is reported from the deepest point it does hold.
 *
 * The pointer is left INSIDE the reported zone in every outcome but
 * `never-entered`, and is restored to where it started when no boundary can be
 * found — a probe that fails is not entitled to leave the drag somewhere else.
 * `edge-moving` is the one refusal that does NOT rewind: the last bracket left
 * the pointer just inside the zone, and putting it back where that bracket
 * began would return it to a position the edge has since travelled past. The
 * zone reported there is read from the pointer's actual containment rather than
 * assumed, so the result describes where the drag really is.
 *
 * Vertical, matching the axis every zone boundary in this suite is crossed on.
 */
export async function dragToInsetInZone(
  driver: ZoneInsetDriver,
  wantInsetPx: number,
  maxSteps = 40,
  /**
   * How this waits between edge measurements.
   *
   * Injected so a FIXTURE can move its edge at the one moment the probe is
   * known to be between brackets, rather than after a duration it has to guess.
   * A fixture keyed to the clock races the process it is testing: pause the
   * runner for longer than the wait and the edge has already moved before the
   * first measurement, so the walk lands in the settled band and the test
   * passes without ever exercising the re-entry it exists to cover.
   *
   * The default is the real wait, so nothing about a live canvas changes.
   */
  settle: (ms: number) => Promise<void> = settleMs
): Promise<ZoneInset> {
  const refuse = (
    zone: number,
    reason: NonNullable<ZoneInset["refused"]>
  ): ZoneInset => ({ zone, resolutionPx: INSET_PROBE_PX, refused: reason });

  // A request this probe cannot represent is a CALLER fault, not a fact about
  // the canvas — so it throws rather than joining the refusals, which a caller
  // is meant to read as findings. A fractional depth would silently round up to
  // the next whole step; a negative or NaN one would skip the walk entirely and
  // report depth 0 as a success, which is a false measurement rather than a
  // failed one.
  if (!Number.isInteger(wantInsetPx) || wantInsetPx < 0) {
    throw new Error(
      `dragToInsetInZone needs a whole, non-negative depth in pixels; got ${wantInsetPx}`
    );
  }
  // The same treatment for the budget, and each bad value fails differently:
  // `Infinity` never terminates and hangs the run until Playwright's outer
  // timeout — defeating the runaway guard this parameter IS — while `NaN` and a
  // negative skip the approach entirely and report `never-entered` about a
  // canvas that was never asked.
  if (!Number.isInteger(maxSteps) || maxSteps < 0) {
    throw new Error(
      `dragToInsetInZone needs a whole, non-negative step budget; got ${maxSteps}`
    );
  }

  const { zone, travelledPx } = await approachZone(driver, maxSteps);
  if (zone < 0) return refuse(-1, "never-entered");

  // How far back the boundary can possibly be. Having WALKED into the zone, it
  // is the distance travelled plus the step that crossed it. Having started
  // inside, travelled is 0 and nothing observed bounds it, so the approach
  // budget stands in — and running out is reported as its own fact rather than
  // as "no zone".
  const retreatLimit =
    travelledPx > 0
      ? travelledPx + INSET_APPROACH_PX
      : maxSteps * INSET_APPROACH_PX;

  // The edge is measured until two consecutive measurements AGREE, because
  // arriving in a zone changes its geometry: the canvas gives a drop zone a
  // 6px height and a 3px margin while a drag is in flight, and a 4px margin
  // once it is the active target — so entering one moves its own edge and
  // every edge below it. A single reading taken across that transition is
  // stale by the time the depth is walked, and the returned depth would be
  // measured from a boundary that has since moved.
  //
  // Measured rather than waited out. A sleep sized to the 100ms transition
  // would put wall-clock dependence into the one control a band assertion
  // rests on, and would still be a guess about a duration the canvas owns.
  let boundaryY: number | null = null;
  for (let attempt = 0; attempt < EDGE_SETTLE_ATTEMPTS; attempt += 1) {
    const found = await bracketZoneEdge(driver, zone, retreatLimit);
    if (!found) return refuse(zone, "boundary-not-found");
    if (boundaryY === found.boundaryY) break;
    boundaryY = found.boundaryY;
    // Exhaustion is decided BEFORE waiting, because the wait is only ever there
    // to separate one bracket from the NEXT one. After the last bracket there
    // is no next one, and waiting anyway gives the edge one more interval to
    // travel — invalidating the containment that bracket just confirmed, so the
    // refusal reads back `-1` and reports being in no zone at all.
    if (attempt === EDGE_SETTLE_ATTEMPTS - 1) {
      // Still moving. Reported rather than measured through: a depth taken from
      // an edge that is in motion is a number with no referent.
      //
      // The pointer is LEFT where the last bracket put it, which that bracket
      // confirmed was inside the zone as its final act. Undoing its movement
      // would return the pointer to where this attempt began — a position the
      // edge has since travelled past, and outside the very zone the result
      // names. A refusal is still a description of where the pointer is, so it
      // may not put the pointer somewhere its own `zone` does not cover.
      //
      // Read back rather than assumed, because "the bracket said so a moment
      // ago" is exactly the claim a moving edge invalidates.
      return refuse(await driver.zoneContainingPointer(), "edge-moving");
    }
    // Across the transition rather than adjacent to it. Two brackets taken back
    // to back land inside the same animation frame and can agree on a whole
    // pixel the edge is still travelling through.
    await settle(EDGE_SETTLE_MS);
  }
  if (boundaryY === null) return refuse(zone, "boundary-not-found");

  for (let moved = 0; moved < wantInsetPx; moved += INSET_PROBE_PX) {
    await driver.moveBy(0, INSET_PROBE_PX);
    if ((await driver.zoneContainingPointer()) !== zone) {
      // Back to the last contained point, so the reported depth is one the
      // pointer is actually standing at. Reporting the overshooting step would
      // overstate the zone's capacity by exactly the step that left it.
      await driver.moveBy(0, -INSET_PROBE_PX);
      return {
        zone,
        insetPx: driver.pointer().y - boundaryY,
        resolutionPx: INSET_PROBE_PX,
        refused: "too-narrow",
      };
    }
  }
  return {
    zone,
    insetPx: driver.pointer().y - boundaryY,
    resolutionPx: INSET_PROBE_PX,
  };
}

/**
 * Carry the drag until the pointer is INSIDE a zone, not merely until one is
 * active.
 *
 * `dragUntilTarget` stops as soon as a target resolves, and
 * `@dnd-kit/collision` resolves one by the dragged shape's OVERLAP when no zone
 * contains the pointer. So "a target is active" and "the pointer is inside that
 * target" are different states, and every exact claim about mapping — is the
 * indicator where the pointer is, do two drags resolve the same way — is only
 * decidable in the second.
 *
 * The distinction is not academic: it is where a stale-scroll or unscaled
 * transform hides. Those implementations select a NEIGHBOURING zone, which any
 * assertion tolerant of the overlap case accepts.
 *
 * Returns the containing zone's ordinal, or -1 if none was reached — a value the
 * CALLER must assert on, for the same reason `dragUntilTarget` says so.
 */
export async function dragUntilInsideZone(
  driver: CanvasDriver,
  maxSteps = 40
): Promise<number> {
  return (await approachZone(driver, maxSteps)).zone;
}

/** The two readings that together say "the shell survived the gesture". */
export interface ShellState {
  readonly url: string;
  readonly hasEditor: boolean;
}

/**
 * Read the shell state a cancelled gesture must not have changed.
 *
 * Both readings, because either alone passes while the other has already gone
 * wrong: the editor can still be in the DOM one tick after navigation began,
 * and a stable URL says nothing about the canvas having unmounted for some
 * other reason.
 *
 * Offered as one reader so a correction reaches every caller. It does not yet
 * have every caller: `checklist.spec.ts` builds the same two readings inline,
 * so a fix made here does not reach it and the two can answer the same named
 * question differently. Routing that one through here is the remaining half.
 */
export async function readShellState(
  page: { url: () => string },
  driver: CanvasDriver
): Promise<ShellState> {
  return { url: page.url(), hasEditor: await driver.isEditorPresent() };
}

/** Where a boundary search left the pointer. */
export interface ZoneEdge {
  /** Active target the pointer rests on, or -1 when no zone was reached. */
  readonly target: number;
  /**
   * Whether the forward walk ever saw the target CHANGE.
   *
   * Separate from {@link bracketed} because the two failures mean opposite
   * things. A canvas whose collision resolution is stuck on one target forever
   * never crosses a boundary, and every jitter afterwards is stable — which
   * reads exactly like a compliant switch margin. Callers must assert this, or
   * an unusable implementation produces the same green as a correct one.
   */
  readonly crossed: boolean;
  /**
   * Whether the reverse search then located the edge to within a pixel.
   *
   * `false` makes any jitter INCONCLUSIVE, not weaker. A resolver that is
   * sticky in one direction only — it advances once and never retreats —
   * satisfies {@link crossed}, leaves this false, and then produces a perfectly
   * stable jitter from the middle of its catchment. That is indistinguishable
   * from a compliant switch margin, so the moment an expected-failure marker
   * comes off, the broken resolver reads as correct.
   *
   * Callers must therefore treat `false` as "this run could not ask the
   * question" rather than as evidence in either direction.
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
  driver: EdgeSearchDriver,
  marginPx = 24
): Promise<ZoneEdge> {
  const first = await dragUntilTarget(driver);
  if (first < 0) return { target: -1, crossed: false, bracketed: false };

  const FORWARD_STEP_PX = 4;
  let crossed = -1;
  let previous = first;
  let seen = first;
  for (let step = 0; step < 120; step += 1) {
    await driver.moveBy(0, FORWARD_STEP_PX);
    // Given the dwell to depart, not sampled. A canvas using the permitted dwell
    // instead of a distance margin can be traversed across a narrow candidate
    // region faster than its timer expires, so an immediate read keeps returning
    // the previous target and the walk concludes the resolver never crosses
    // anything. Both suites assert `crossed` before their marker, so that
    // compliant implementation would fail the harness rather than the
    // requirement.
    //
    // Departure rather than full settling: this loop only asks whether the
    // target left `previous`, and returning the moment it does keeps the
    // overshoot the reverse budget below has to carry down to one step.
    //
    // Two baselines, because the walk asks two different questions. `seen` is
    // the last value OBSERVED, `-1` included, and departure is measured from
    // it: leaving the baseline at the last real zone while the pointer sits in
    // dead space makes every later read differ from it immediately, so the
    // wait expires at once and the walk races through the next narrow zone
    // before a compliant timer can activate it. `previous` is the last ZONE,
    // which is what a crossing is measured against — arriving in dead space is
    // not a crossing.
    const current = await departureFrom(
      () => driver.readActiveTarget(),
      seen,
      dwellAllowanceOf(driver)
    );
    seen = current;
    if (current >= 0 && current !== previous) {
      crossed = current;
      break;
    }
    if (current >= 0) previous = current;
  }
  if (crossed < 0) {
    return { target: previous, crossed: false, bracketed: false };
  }

  // The reverse budget carries the FORWARD step's overshoot. A 4px scan first
  // observes the new target up to 3px past the point where it switched, so
  // walking back the margin alone falls short by that much and reports a
  // compliant canvas as unbracketed. The distance to search is the margin the
  // requirement allows plus however far the coarse step could have overshot it.
  const reverseBudget = marginPx + FORWARD_STEP_PX - 1;
  for (let step = 0; step < reverseBudget; step += 1) {
    await driver.moveBy(0, -1);
    // The dwell applies walking back too. These are one-pixel commands, so a
    // compliant timer-based canvas can be carried through the whole reverse
    // budget in less time than one dwell — every immediate read then still says
    // `crossed`, the edge is never bracketed, and both hysteresis tests skip
    // without having tested the implementation.
    const stepped = await departureFrom(
      () => driver.readActiveTarget(),
      crossed,
      dwellAllowanceOf(driver)
    );
    if (stepped !== crossed) {
      await driver.moveBy(0, 1);
      return { target: crossed, crossed: true, bracketed: true };
    }
  }
  return { target: crossed, crossed: true, bracketed: false };
}

/** What a dwell-aware jitter observed, and whether it could observe anything. */
export interface JitterProbe {
  /** Target transitions recorded inside the page, or undefined if inconclusive. */
  readonly transitions: ActiveTargetTransition[] | undefined;
  /** The slowest single move across the sweeps that ran, in milliseconds. */
  readonly slowestMoveMs: number;
  /** The allowance a move had to stay under for the sweep to count. */
  readonly dwellAllowanceMs: number;
  /** How many sweeps were attempted. */
  readonly sweeps: number;
}

/**
 * Oscillate across a bracketed edge, and report whether the probe was VALID.
 *
 * The requirement permits hysteresis expressed as a dwell of more than 100ms
 * instead of a distance margin, and every `moveBy` is a CDP round trip whose
 * duration belongs to the machine rather than to the canvas. On a loaded runner
 * a single move can outlast that dwell, which means the pointer rested at an
 * endpoint long enough for a COMPLIANT timer to commit — and any flip observed
 * afterwards says nothing about hysteresis.
 *
 * So the sweep is timed and repeated, and only a sweep whose slowest move stayed
 * inside the allowance is returned. Each sweep is balanced (ten moves of +4
 * against ten of -4) so it ends where it began and a repeat re-probes the same
 * edge.
 *
 * Shared rather than reimplemented. An acceptance probe that jitters without
 * timing reports a compliant dwell-based canvas as the known missing-hysteresis
 * failure, on a machine property, and nothing in its output says so.
 */
export async function jitterAcrossEdge(
  driver: JitterDriver,
  { sweeps = 3, dwellAllowanceMs = PERMITTED_DWELL_FLOOR_MS } = {}
): Promise<JitterProbe> {
  // To P-2 first, then alternating by 4, so the samples are P-2 and P+2 —
  // genuinely opposite sides. Alternating +/-2 from P samples P+2 and P, both
  // on the same side, which a canvas that switches the instant the pointer
  // crosses would still pass.
  await driver.moveBy(0, -2);
  // Settled BEFORE the recorder exists, so no dwell started by the positioning
  // move is still pending when observation begins. The interval between that
  // move and the first timing mark is not covered by the sweep's own
  // measurement, so a slow round trip there could let a compliant timer commit
  // while the observer was active — putting a transition in the log that the
  // jitter never provoked, inside a sweep whose measured moves all look fast
  // enough to trust. That is the one thing this probe exists to distinguish.
  await settledTarget(driver);

  let slowestMoveMs = Number.POSITIVE_INFINITY;
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    const readTransitions = await driver.recordActiveTargetTransitions();
    // CONTINUOUS marks, not per-command durations. A stopwatch around each
    // `moveBy` measures only the time inside the command and misses the gap
    // between them — and if the test process is descheduled in that gap, two
    // fast commands still leave their browser events far apart.
    //
    // Marking the clock at every boundary makes the elapsed time cover the gaps
    // too: `marks[i]` is the instant before move `i`, and the last mark is
    // after the final one, so no wall-clock time between the first and last
    // move is unaccounted for.
    const marks: number[] = [Date.now()];
    for (let step = 0; step < 20; step += 1) {
      await driver.moveBy(0, step % 2 === 0 ? 4 : -4);
      marks.push(Date.now());
    }
    const log = await readTransitions();
    // The TEARDOWN tail counts too. The recorder is still observing between the
    // final move and the moment it disconnects, so a stall there lets a
    // compliant dwell timer commit — and that commit lands in the log while
    // every measured move window stays under the allowance. The probe would
    // then read a terminal dwell as a jitter-induced transition, which is the
    // one thing it exists to distinguish.
    marks.push(Date.now());
    // The widest window that can hold two consecutive pointer EVENTS. Each
    // event fires somewhere inside its own command, so the pair from move `i`
    // and move `i+1` is contained by the span from BEFORE move `i` to AFTER
    // move `i+1` — `marks[i+2] - marks[i]`. Because the marks are continuous,
    // that span includes any time the process spent descheduled between the
    // two commands, which a per-command stopwatch cannot see.
    //
    // It over-estimates, so some runs are skipped that could have been
    // measured. That is the safe direction: the alternative is classifying a
    // canvas with a permitted dwell as having no hysteresis at all.
    slowestMoveMs = 0;
    for (let index = 0; index + 2 < marks.length; index += 1) {
      const window = (marks[index + 2] ?? 0) - (marks[index] ?? 0);
      if (window > slowestMoveMs) slowestMoveMs = window;
    }
    if (slowestMoveMs < dwellAllowanceMs) {
      return {
        transitions: log,
        slowestMoveMs,
        dwellAllowanceMs,
        sweeps: sweep + 1,
      };
    }
  }
  return {
    transitions: undefined,
    slowestMoveMs,
    dwellAllowanceMs,
    sweeps,
  };
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
