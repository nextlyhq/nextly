/**
 * One canvas drag's own record and the questions asked of it.
 *
 * `useCanvasDrag` in `canvas-drag.tsx` holds a {@link Gesture} while a press
 * is down. What that record is, which pointer owns it, the target a release
 * would commit to, the locks' verdict on where it aims, the rectangles measured
 * when it began, and how a point from another document reaches the canvas's
 * all live here, so the hook keeps only the wiring of events to these answers.
 *
 * @module canvas-drag-gesture
 */

import {
  type BlockNode,
  COMPONENT_INSTANCE_TYPE,
  declaredSlotNames,
  type PlacedNode,
  type PlacementSources,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import { isOutermostForAddress, nodeAddressOf } from "./canvas";
import type { DragSubject } from "./canvas-drag-types";
import type { CanvasFrame } from "./canvas-frame-context";
import type {
  DropRegion,
  DropResolution,
  DropTarget,
  RectSource,
  RegionVerdicts,
} from "./drop-targets";
import type { EditorState } from "./editor-state";
import type { Point, Rect } from "./geometry";
import {
  canvasContentRect,
  framePaintedScale,
  hostPointInFrame,
} from "./geometry-dom";
import type { LockDropRefusal, LockRefusalFacts } from "./lock-refusal";
import type { OpPosition } from "./op-vocabulary";
import type { TargetSwitchState } from "./target-switch";

/**
 * Hand the pointer back, when this transport is the one holding it.
 *
 * A node-origin drag captures on the canvas root; a palette drag captures
 * nowhere and passes `null`. Asked of the element rather than tracked, because
 * the browser releases capture itself on some endings and a flag would then
 * describe a capture that is already gone.
 */
export function releaseCapture(
  host: HTMLElement | null,
  pointerId: number
): void {
  if (host !== null && host.hasPointerCapture(pointerId)) {
    host.releasePointerCapture(pointerId);
  }
}

/**
 * The target a release would commit to, or `undefined` when there is none.
 *
 * ONE absent value, not two. Written as `null` for "nothing committed" and
 * `undefined` for "committed to something no longer drawable", the caller
 * would have to exclude both — and excluding one reads as complete, so a drag
 * released over no target would reach `target.at`.
 */
export function committedTarget(drag: Gesture): DropTarget | undefined {
  const committed = drag.switchState.committed;
  return committed === null ? undefined : drag.targets.get(committed);
}

/**
 * The gesture this pointer owns, or `null` when it owns none.
 *
 * The one answer to "may this event drive the drag", asked by every transport:
 * the canvas's React handlers for a pointer over the canvas, and the document
 * listeners for one anywhere else. Written once because it was written three
 * times — move, release and cancel each compared the id themselves, and a
 * change to what ownership means would have had to find all three.
 */
export function gestureOwnedBy(
  current: Gesture | null,
  pointerId: number
): Gesture | null {
  if (current === null) return null;
  return current.owner === pointerId ? current : null;
}

/**
 * Whether a press may begin a gesture.
 *
 * A drag ALREADY IN FLIGHT keeps the pointer that started it: a second finger
 * must not take it over, or the first gesture is left with no ending of its own
 * — its release unheard, its click never suppressed.
 *
 * An INACTIVE gesture is a different thing and must not block anything. It is a
 * press that has not yet travelled far enough to mean a drag, and one can be
 * stranded: a press beginning within the activation threshold of the canvas
 * edge takes no capture, so if the pointer leaves the root its move and release
 * are delivered somewhere these handlers never see. Refusing later presses
 * because of it would lock dragging until the host unmounted, and there is
 * nothing to protect — no drag was in progress.
 */
export function admitsPress(current: Gesture | null): boolean {
  return current === null || !current.active;
}

/** Where the pointer aims, with a target the locks refuse turned into a refusal. */
type AimResolution =
  | DropResolution
  | { readonly kind: "refused"; readonly refusal: LockDropRefusal };

/**
 * A resolved target the editor's locks refuse, answered as a refusal that says
 * so. Asked of the editor's own `lockRefusalFor`, the question its apply asks,
 * so the indicator never offers a drop the release would then refuse.
 */
export function withLockVerdict(
  drag: Gesture,
  editor: Pick<EditorState, "lockRefusalFor">,
  resolution: DropResolution
): AimResolution {
  if (resolution.kind !== "target") return resolution;
  const target = resolution.target;
  let verdict = drag.lockVerdicts.get(target.id);
  if (verdict === undefined) {
    verdict = lockVerdictAt(drag.subject, target.at, editor) ?? null;
    drag.lockVerdicts.set(target.id, verdict);
  }
  if (verdict === null) return resolution;
  return {
    kind: "refused",
    refusal: {
      regionId: target.regionId,
      ...(target.at.parentId === undefined
        ? {}
        : { parentId: target.at.parentId }),
      lock: verdict,
    },
  };
}

/**
 * A thunk that builds its node on the first call and hands back that node
 * after, so one gesture judges and inserts one node. Building twice would
 * judge one subtree and insert another, with ids of its own.
 */
export function builtOnce(
  make: () => BlockNode | null
): () => BlockNode | null {
  let built: { node: BlockNode | null } | undefined;
  return () => (built ??= { node: make() }).node;
}

/** The lock break dropping the subject at `at` would add. */
function lockVerdictAt(
  subject: DragSubject,
  at: OpPosition,
  editor: Pick<EditorState, "lockRefusalFor">
): LockRefusalFacts | undefined {
  if (subject.kind === "move") {
    return editor.lockRefusalFor([
      { kind: "move", id: subject.nodeId, to: at },
    ]);
  }
  // The node an insert would place, starting blocks and all: a block whose
  // own slots are locked is judged as it would land, not as an empty shell.
  const node = subject.makeNode();
  return node === null
    ? undefined
    : editor.lockRefusalFor([{ kind: "insert", node, at }]);
}

/**
 * A press on a block a Layers lock holds in place: whose pointer, where it
 * began, the block, the lock's facts, and whether its reason is drawn.
 */
export interface HeldPress {
  readonly owner: number;
  readonly originClient: { readonly x: number; readonly y: number };
  readonly nodeId: string;
  readonly blockName: string;
  readonly lock: LockRefusalFacts;
  shown: boolean;
}

/** What a drag needs to remember, none of which renders. */
export interface Gesture {
  readonly subject: DragSubject;
  /**
   * The pointer that began this gesture, and the only one that may drive it.
   *
   * A node-origin drag takes pointer capture, which retargets one pointer and
   * leaves the rest alone — so this is redundant there and costs nothing. A
   * palette drag deliberately takes no capture, because the browser resolves a
   * click against the capturing element and the row must keep inserting on
   * click. Its events therefore arrive by two transports, the canvas's own
   * React handlers and the document listeners, and BOTH see every active
   * pointer on a touch device.
   *
   * Kept on the gesture rather than checked in each transport's closure: the
   * two entry points below are where every pointer event of either transport
   * converges, so enforcing it there covers a route a closure check would
   * miss — a second finger moving over the CANVAS reaches the React handler,
   * not the document listener.
   */
  readonly owner: number;
  readonly origin: Point;
  /**
   * Where the press landed in CLIENT pixels.
   *
   * Kept beside {@link origin} rather than derived from it, because the two
   * answer different questions and a scaled canvas separates them. `origin` is
   * in the canvas's own content coordinates, which is what a hit test needs;
   * the thresholds below are about how far a HAND moved, which is a fact about
   * the person and not about the document's coordinate system.
   *
   * Measured in content pixels they shrink with the canvas: at a canvas painted
   * to 71%, the 4px that separates a click from a drag needs only 2.85px of
   * real movement, so ordinary click jitter starts committing moves — and the
   * target hysteresis loosens by the same factor at the same time.
   *
   * In the canvas document's client coordinates, like every later point of
   * the gesture, and turned into the author's pixels by {@link handScale}.
   */
  readonly originClient: Point;
  /**
   * How many of the author's on-screen pixels one of the canvas document's
   * client pixels is: `1` in the editor's own document, the frame's painted
   * scale in a frame. The host paints a frame scaled, and nothing read inside
   * the frame shows it, so a distance measured there is multiplied by this
   * before any threshold about the hand is applied to it. Read once at the
   * press: the scale does not change during a gesture.
   */
  readonly handScale: number;
  readonly regions: readonly DropRegion[];
  readonly rects: RectSource;
  readonly forbiddenParents: ReadonlySet<string>;
  readonly blockName: string;
  /**
   * What the placement is judged by: the block's own type, or an instance's
   * resolved roots. Computed once at the press — the definitions a drag
   * resolves against do not change mid-gesture.
   */
  readonly blockNames: readonly string[];
  /**
   * The blocks being placed, with everything inside them, which the one
   * placement rule judges. Asked only when a region is judged, because an
   * insert's answer is the node its palette builds, the very node the release
   * inserts. Empty when the palette builds nothing; the name rules then judge
   * `blockNames` as before.
   */
  readonly placing: () => readonly PlacedNode[];
  /**
   * The placement rule's answer for each region, asked once for the gesture's
   * life, as the lock verdicts are: the document, the blocks and the regions
   * do not change mid-drag, and every pointer move and autoscroll frame
   * resolves the drop again.
   */
  readonly placementVerdicts: RegionVerdicts;
  /** False until the pointer has travelled far enough to mean a drag. */
  active: boolean;
  switchState: TargetSwitchState;
  /** Targets by id, so the committed id resolves back to something drawable. */
  targets: Map<string, DropTarget>;
  /**
   * Each target's lock verdict, asked once for the gesture's life: the document
   * does not change mid-drag, and asking per pointer move would apply the edit
   * speculatively on every frame.
   */
  lockVerdicts: Map<string, LockRefusalFacts | null>;
  /**
   * The canvas root, kept so a frame with no pointer event still has it.
   *
   * Autoscroll runs between moves — a pointer resting in the edge band produces
   * no events at all — so the element cannot come from `event.currentTarget`
   * the way every other read here does.
   */
  readonly root: HTMLElement;
  /**
   * The element that actually scrolls, or `null` when nothing does.
   *
   * Resolved once at drag start rather than per frame: it is a walk up the tree
   * reading computed styles, and the answer cannot change mid-gesture.
   */
  readonly scroller: Element | null;
  /** The last pointer position, in the canvas document's CLIENT coordinates. */
  clientX: number;
  clientY: number;
  /** The scheduled frame, or `null` when no loop is running. */
  frame: number | null;
}

/**
 * The identity half of {@link CanvasDragState}, for whichever subject is in
 * flight.
 *
 * Derived in one place rather than spelled out at each `setState`, so the two
 * fields cannot drift into disagreeing about whether a drag is happening: an
 * insert has no `draggingId`, and a site that set the id alone would report no
 * drag at all to everything gated on the block name.
 */
export function drawnSubject(drag: Gesture): {
  draggingId: string | null;
  draggingBlockName: string;
} {
  return {
    draggingId: drag.subject.kind === "move" ? drag.subject.nodeId : null,
    draggingBlockName: drag.blockName,
  };
}

/**
 * Every rendered node's rectangle, read once.
 *
 * Compared in JavaScript rather than matched with a selector built from an id:
 * a node id reaches this from stored data, and interpolating it into
 * `querySelector` makes any character CSS treats specially either throw or,
 * worse, match a different element.
 */
export function snapshotRects(root: HTMLElement): RectSource {
  const measured = new Map<string, Rect>();
  // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
  // that declares its iterator, and this package compiles without one.
  root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    // The ADDRESS a drag asks by, not the raw attribute. `collectRegions`
    // requests rectangles by the id the document holds, and a definition-owned
    // element carries a re-minted one — so keying by the attribute leaves every
    // child of a component unmeasured. `targetsInRegion` then reads a root with
    // no measured children and collapses it to one index-0 midpoint, so
    // releasing a drag moves the component to the start whatever was under the
    // pointer.
    //
    // Reachable only since the hit test began answering with instance ids: the
    // drag used to bail before this, because `findNode` could not resolve the
    // re-minted id. Making that path work is what exposed this.
    const id = nodeAddressOf(element);
    // OUTERMOST only, so an instance is measured as its own box rather than as
    // whichever element its definition contributed last. A node a block
    // rendered more than once still measures every copy, because sibling copies
    // are each outermost — the last one wins there exactly as it did before.
    if (id !== null && isOutermostForAddress(element, id, root)) {
      measured.set(id, canvasContentRect(element, root));
    }
  });
  // The canvas's own box, measured through the SAME reader as the blocks
  // inside it. `scrollWidth`/`scrollHeight` describe the whole content rather
  // than the part on screen, and mixing them with a rectangle read means the
  // region and its children answer to two different measurements — which is
  // the disagreement this package keeps its geometry in one place to avoid.
  //
  // The visible box is also the correct extent for what it is used for: it
  // decides whether the POINTER is inside the canvas, and a pointer cannot be
  // over content that is scrolled out of view.
  const rootRect: Rect = canvasContentRect(root, root);
  return {
    rectOf: id => measured.get(id),
    rootRect: () => rootRect,
  };
}

/**
 * Listen for one event type on every document given, in the capture phase.
 *
 * Returns the function that removes exactly the listeners added, so a caller
 * holding it cannot remove from one document and leave the other listening.
 */
export function listenOn<K extends keyof DocumentEventMap>(
  documents: readonly Document[],
  type: K,
  listener: (event: DocumentEventMap[K]) => void
): () => void {
  for (const doc of documents) doc.addEventListener(type, listener, true);
  return () => {
    for (const doc of documents) doc.removeEventListener(type, listener, true);
  };
}

/**
 * The window the canvas root's frame loop runs in.
 *
 * The ROOT's, because a frame's animation callbacks are paced by that frame's
 * own rendering, and a loop scheduled on another window's clock scrolls the
 * frame out of step with what it paints. `null` for a root whose document has
 * no window, where there is no frame to schedule on.
 */
export function frameLoopOf(drag: Gesture): Window | null {
  return drag.root.ownerDocument.defaultView;
}

/**
 * How many of the author's on-screen pixels one canvas client pixel is.
 *
 * See {@link Gesture.handScale}.
 */
export function handScaleOf(canvas: CanvasFrame): number {
  return canvas.frame === null ? 1 : framePaintedScale(canvas.frame);
}

/**
 * A point delivered to `doc`, in the canvas document's client coordinates.
 *
 * The canvas's own document, and every document while there is no frame,
 * already reports in them. The editor's document reports in its own, which are
 * carried into the frame's: every rectangle of the canvas is read inside the
 * frame, so a point from the panels means nothing there until it is mapped.
 */
export function canvasClientPoint(
  canvas: CanvasFrame,
  doc: Document,
  clientX: number,
  clientY: number
): Point {
  const point = { x: clientX, y: clientY };
  return canvas.frame === null || doc === canvas.document
    ? point
    : hostPointInFrame(canvas.frame, point);
}

/**
 * The slots a component placement exposes, which its type alone cannot say.
 * Every other block answers undefined, so its regions come from the caller's
 * `slots` source, the one this hook documents as each type's child regions.
 */
export function slotsOfNode(
  sources: PlacementSources
): (node: BlockNode) => readonly string[] | undefined {
  return node =>
    node.type === COMPONENT_INSTANCE_TYPE
      ? declaredSlotNames(node, sources)
      : undefined;
}
