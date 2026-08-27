"use client";

/**
 * The affordance drawn over a container with nothing in it.
 *
 * An empty `core/box`, `core/card`, `core/section` or `core/columns` renders an
 * element with no children, so a container that exists only to HOLD something
 * else has no size, no visible boundary and nothing a pointer can land on.
 * `builder-chrome.css`'s `[data-nx-slots]:empty` rule already gives it a 44px
 * dashed box so it is not literally invisible, but a box is not a control:
 * nothing about it says "click here", nothing names what it would hold, and
 * pressing it only SELECTS the container rather than offering to fill it. That
 * rule's own docblock names the remedy: "a follow-up that draws a real
 * positioned element over each empty container, rather than styling the
 * container itself" — this is that follow-up.
 *
 * This draws a labelled "+" over each such container instead. Pressing one
 * only reports the container's id through
 * {@link EmptyContainerAppendersProps.onAppend}; it does not select anything
 * or open an inserter. Once a container IS selected, `insertionPointFor`
 * already reads {@link emptySlotOf} to decide that a new block goes INSIDE it
 * rather than beside it — so wiring a press to select-then-open needs no new
 * targeting path, and this component needs no knowledge of the editor at all.
 *
 * ## One question, answered once
 *
 * "Which of this node's declared slots is empty" is `emptySlotOf`'s question,
 * already asked by the inserter to decide where a chosen block lands. A second
 * copy of that question here would agree with the inserter on the day both were
 * written and drift afterwards — an author offered a control that the inserter
 * then fills somewhere else, which is exactly the failure recomputing it would
 * risk.
 *
 * ## Positioning follows `spacing-overlay.tsx`
 *
 * Both draw a rectangle over a node found by its `NODE_ID_ATTRIBUTE` address,
 * and both need the same correction: the canvas is zoomable through CSS
 * `zoom`, so an element's `offsetWidth` is its LAYOUT size while
 * `getBoundingClientRect()` is its PAINTED one, and the two agree only at
 * 100%. `canvasContentRect` (`geometry-dom.ts`) already divides the painted
 * rectangle back down by the canvas root's own painted scale, so measuring
 * through it — exactly as `spacing-overlay.tsx` and `block-toolbar.tsx`
 * already do — inherits correct placement at any zoom without this file doing
 * any scale arithmetic of its own. Computing an offset directly from a client
 * rectangle here would be the second implementation `geometry.ts` warns
 * against: unscaled, it is wrong by `(1 - scale) * inset`, exactly zero at
 * 100% and invisible in precisely the configuration most testing happens in.
 *
 * ## A fixed, centred square rather than a rectangle sized to the container
 *
 * The button does not stretch to the measured rectangle's own width and
 * height. It is a fixed {@link APPENDER_SIZE_PX} square centred inside it,
 * and that is a correction rather than a style choice.
 *
 * `emptySlotOf` names which SLOT is empty, but there is no DOM address for
 * "slot X of node Y" to measure — `NODE_ID_ATTRIBUTE` marks a node's whole
 * root element, and a node with several declared slots renders all of them
 * inside that one root. So the only rectangle measurable here is the node's
 * entire root, whether or not every slot inside it is empty. A button sized
 * to that rectangle sits over a POPULATED later slot exactly as much as over
 * the empty first one, stealing the pointer clicks the populated slot's own
 * content should get. A fixed small square anchored to the root's centre
 * cannot do that: the worst it can overlap is a small area near the middle,
 * never the slot's whole content.
 *
 * The same fix answers a second problem for free. `canvasContentRect` reports
 * a node's rectangle whether or not an authored ancestor clips it, because
 * clipping happens in the DOM and this overlay draws in the root's flat
 * coordinate space above it — so a full-bleed button drawn there paints over
 * whatever unrelated content happens to sit at the un-clipped position. A
 * clipped container is excluded outright below (see `measure`, and
 * `clippedByAncestorRect` in `geometry-dom.ts`), and the fixed size is what
 * makes that exclusion cheap to reason about: declining a single small square
 * costs far less than declining a rectangle that might have spanned most of
 * the canvas, and a control that never reaches a container's corners has no
 * need of `clippedByAncestor`'s corner-aware refinement — see `measure` for
 * why asking that stricter question here would cost more than it protects.
 *
 * For the ordinary case this changes nothing an author can see: the container
 * the control is drawn on is one `builder-chrome.css` has already given a 44px
 * box, so centring a 44px square inside its measured rectangle places the
 * control exactly where that box already is. That sentence is only true
 * because of the condition below, which is what makes the box's presence a
 * guarantee rather than an assumption.
 *
 * ## Which containers get a control is the STYLESHEET's question
 *
 * `emptySlotOf` decides which containers this component knows about, and that
 * is a question about the stored document. Whether an affordance is drawn is a
 * question about the RENDER, and `builder-chrome.css` already asks it:
 * {@link EMPTY_CONTAINER_SELECTOR}. `measure` asks the same one of the same
 * element rather than trusting the two to describe the same containers.
 *
 * They do not. A node can have an empty slot inside a root that renders
 * content of its own — `core/accordion-item` puts a `<summary>` beside its
 * slot, so a closed one has an empty `children` slot and a root that is not
 * `:empty`. The stylesheet declined such a container, this component did not,
 * and the fixed-size control was then centred in a rectangle sized by the
 * summary rather than by a box that was never drawn. A node rendering several
 * slots is the same shape: its root is not `:empty` while a later slot holds
 * anything, which is precisely when a control over its centre would sit on a
 * populated region.
 *
 * The rule's ANCESTOR conditions are part of that question and not a detail of
 * how the stylesheet is written. Its box is scoped to a builder shell that has
 * not been asked to hide empty-element chrome, and `Canvas` and this component
 * are both exported — so a host composing them with no shell renders containers
 * the element-level condition accepts and the rule never reaches. Asking the
 * whole selector is what keeps "there is a box here" a fact rather than an
 * assumption about how the caller mounted this.
 *
 * The consequence is that a container carrying no visual affordance gets no
 * control either, which is the point rather than a shortfall — it is still
 * fillable, because selecting it and inserting routes through `emptySlotOf`
 * in `insertionPointFor` exactly as before.
 *
 * ## Never outside its own container
 *
 * The control is additionally CLAMPED to the measured rectangle, because the
 * stylesheet guarantees a minimum height and not a minimum width. An empty
 * container narrower than the control is legitimate — a narrow column — and an
 * unclamped square centred in it hangs over both edges, onto whatever sits
 * beside it. Since the overlay paints in document order, a control that
 * escapes its own container lands on top of an earlier sibling and takes the
 * press meant for it. The full-bleed button this replaced could not do that;
 * containment is the property that had to be kept when the size stopped
 * matching the container.
 *
 * ## Identity is independent of geometry, and has to stay that way
 *
 * Which containers get a control comes from the DOCUMENT alone, and
 * {@link emptyContainersIn} has to stay that way — it reads no DOM, so a
 * component with no canvas root still knows its whole set. What a measurement
 * pass concludes about one of those containers is a LATER, separate question,
 * and it has three answers rather than two:
 *
 * - MEASURED — the pass found the element, accepted it, and holds a rectangle.
 * - DECLINED — the pass reached this container and refused it, for one of
 *   four reasons: the render produced no element for it at all, the
 *   stylesheet drew no box for the element it did produce (see the section
 *   above), the author positioned it against the VIEWPORT rather than against
 *   the page, or an authored ancestor clips it (the last two: see `measure`).
 *   All four are re-decided on every pass, so each is a refusal for as long as
 *   the render keeps this shape rather than a permanent one.
 * - UNMEASURED — no pass has run at all, because there is no canvas root to
 *   run one against. Nothing has been asked about any container yet.
 *
 * An UNMEASURED control RENDERS, at `{ x: 0, y: 0, width: 0, height: 0 }`,
 * which is the property this section exists to protect: a control an author
 * cannot yet see on screen is still a control a screen reader can reach, and a
 * test asserting it exists must not depend on a browser having laid anything
 * out. Hiding it would remove it from the accessibility tree, which is exactly
 * the state the bare-mount cases in `empty-container-appender.test.tsx` render
 * in — a component with no canvas root at all — so a hidden-until-measured
 * design would make every one of those fail to find a control that, mounted
 * for real, is there all along.
 *
 * A DECLINED control renders NOTHING, which is the same argument read the
 * other way. It is not a control waiting to be placed; it is one this
 * component has decided not to offer, so keeping it in the accessibility tree
 * leaves a zero-sized button in the tab order — reachable, announced by name,
 * and invisible. `.nx-empty-container-appenders__button` is `display: flex`
 * and `pointer-events: auto`, and its `:focus-visible` rule would draw an
 * outline on a box with no area. A `core/accordion-item` whose `children` slot
 * is empty reaches that state from its own `defaultProps`, and so does any
 * node `PageRenderer` leaves out of the tree it draws — one carrying
 * `visibility.conditions`, or one whose props make it draw nothing — which the
 * document goes on listing for as long as the author keeps it.
 *
 * The two used to share one representation — no entry in the measurement map —
 * so "not yet" and "never" were the same value and the second inherited the
 * first's behaviour. A pass therefore records a {@link RecordedPlacement} for
 * every container it REACHED, a rectangle or a refusal, which leaves absence
 * meaning the one thing it can still mean. {@link controlRectFor} is the only
 * place those three become the two things a render can do, switched
 * exhaustively so a fourth state cannot fall through a `default` arm.
 *
 * @module empty-container-appender
 */

import {
  walkNodes,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { CANVAS_ROOT_CLASS, CHROME_ATTRIBUTE, nodeElement } from "./canvas";
import { watchCanvasFor } from "./canvas-geometry-watch";
import { EMPTY_CONTAINER_SELECTOR, emptySlotOf } from "./empty-slot";
import type { Rect } from "./geometry";
import {
  canvasContentRect,
  canvasRootFrom,
  clippedByAncestorRect,
  viewportPositioned,
} from "./geometry-dom";
import type { SlotSource } from "./inserter";
import { authoredName } from "./layers";

/**
 * The one property this component ever reads off a block's definition.
 *
 * A block's full definition (`AnyBlockDefinition` in `@nextlyhq/blocks-engine`)
 * requires `name`, `version`, `description`, `example`, `render` and more —
 * none of which `nameOf` below touches. Narrowed to just the field actually
 * read, so a fixture standing in for one is an honest, minimal object rather
 * than a full definition wearing a cast to get past the compiler.
 *
 * Still satisfied by the real thing with no adapter: `AnyBlockDefinition`'s
 * own `editor` field is `BlockEditorMeta`, which carries more than this needs
 * but remains structurally assignable to it, so the live registry's
 * `getBlock` — returning `AnyBlockDefinition | undefined` — is a valid
 * `BlockLookup["get"]` as it stands.
 */
interface LabelledBlock {
  readonly editor?: { readonly label?: string };
}

/**
 * Resolves a block type to (at most) the one property this component reads.
 *
 * Named apart from `AnyBlockDefinition` — the registry's own interface — for
 * the same reason `LabelledBlock` is narrowed: a caller may hand this the live
 * registry (`{ get: getBlock }`) or a plain fixture with nothing registered,
 * and both satisfy it with no adapter in between.
 */
interface BlockLookup {
  get(type: string): LabelledBlock | undefined;
}

/** One container this component offers a control for, and its accessible name. */
interface EmptyContainer {
  readonly id: string;
  readonly label: string;
}

/**
 * The name this control announces for the block it would fill.
 *
 * The AUTHORED instance name wins when the node has one — via
 * `authoredName`, the same precedence `layerLabel` gives the Layers panel, so
 * two empty containers of the same type an author has told apart by name are
 * told apart here too rather than announcing as one indistinguishable
 * control. Without one, `editor.label` when the block declares it. Otherwise
 * the block's raw TYPE — not a humanised guess — because this is an
 * accessible NAME rather than a palette entry: a control an author cannot
 * name is one they cannot find, and the type string names the missing block
 * truthfully even when no definition is registered to describe it at all.
 *
 * `layerLabel` itself is not called directly: it resolves the type-level
 * fallback through the GLOBAL registry (`blockLabel`), where this component
 * takes an injected {@link BlockLookup} so its tests need not register
 * anything there. `authoredName` is the part of `layerLabel` that does not
 * depend on the registry, and it is exported from `layers.ts` for exactly
 * this reuse.
 *
 * An empty string is treated the same as an absent label: a block declaring
 * `editor: { label: "" }` has not actually named itself, and announcing an
 * empty string would leave the control with no accessible name at all.
 */
function nameOf(node: BlockNode, blocks: BlockLookup): string {
  const named = authoredName(node);
  if (named !== undefined) return named;
  const declared = blocks.get(node.type)?.editor?.label;
  return declared !== undefined && declared !== "" ? declared : node.type;
}

/**
 * Every container in the document with nothing in its first declared slot.
 *
 * `walkNodes` rather than a walk written here: it is cycle-safe and
 * depth-bounded, and it descends into every slot of every node regardless of
 * whether that node itself gets a control — so a container nested inside
 * another empty one is still found. A hand-written recursive walk would lose
 * that depth guarantee the first time a document was deeper than the call
 * stack allows, which is exactly the shape a persisted document can arrive in
 * whether or not anything validated it first.
 */
function emptyContainersIn(
  document: BlockDocument,
  slots: SlotSource,
  blocks: BlockLookup
): EmptyContainer[] {
  const found: EmptyContainer[] = [];
  walkNodes(document.nodes, node => {
    if (emptySlotOf(node, slots) !== null) {
      found.push({ id: node.id, label: nameOf(node, blocks) });
    }
  });
  return found;
}

/**
 * A rectangle with no measurement yet.
 *
 * Zero-sized rather than absent, so an unmeasured control still occupies a
 * point in the canvas's coordinate space instead of carrying no position at
 * all — see the module docblock for why it must render regardless. It belongs
 * to the UNMEASURED state alone: a declined container draws nothing, so it
 * never reaches a rectangle at all.
 */
const UNMEASURED_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * What one measurement pass concluded about a container it REACHED.
 *
 * A refusal is a value here rather than the absence of one, because absence
 * already means something else — see the module docblock's three states. Both
 * members are recorded by `measure`, which records one for EVERY container it
 * is handed once it has a root: the map is empty only where there was no root
 * to run a pass against.
 */
type RecordedPlacement =
  | { readonly kind: "measured"; readonly rect: Rect }
  | { readonly kind: "declined" };

/** A container's state, including the one a pass records by omission. */
type Placement = RecordedPlacement | { readonly kind: "unmeasured" };

/** The refusal, shared rather than allocated once per declined container. */
const DECLINED: RecordedPlacement = { kind: "declined" };

/** What a container absent from a pass's map is in. */
const UNMEASURED: Placement = { kind: "unmeasured" };

/** No container reached: the identity returned before any pass runs. */
const NO_PLACEMENTS: ReadonlyMap<string, RecordedPlacement> = new Map();

/**
 * Where to draw a container's control, or `null` when it gets none.
 *
 * The single place a missing entry is given its meaning, so no caller has to
 * agree with another about what one stands for. `switch` with no `default`: a
 * fourth state would leave this able to return `undefined`, which the declared
 * type refuses — the same property `rectCut` in `geometry-dom.ts` relies on,
 * rather than a `default` arm that would silently absorb it.
 */
function controlRectFor(
  placements: ReadonlyMap<string, RecordedPlacement>,
  id: string
): Rect | null {
  const placement: Placement = placements.get(id) ?? UNMEASURED;
  switch (placement.kind) {
    case "measured":
      return placement.rect;
    case "declined":
      return null;
    case "unmeasured":
      return UNMEASURED_RECT;
  }
}

/**
 * The control's fixed side length, in the canvas's content pixels.
 *
 * Matches `builder-chrome.css`'s `[data-nx-slots]:empty` rule, whose
 * `min-height: 2.75rem` (44px) is that stylesheet's own answer to "how small
 * can a pointer target be and still be comfortable". Reusing the number
 * rather than picking a second one keeps the control's footprint no larger
 * than the placeholder box it already draws attention to.
 */
const APPENDER_SIZE_PX = 44;

/**
 * A {@link APPENDER_SIZE_PX} square centred inside a rectangle, never larger
 * than the rectangle itself.
 *
 * See the module docblock ("A fixed, centred square") for why the button is
 * not sized to the measured rectangle, and ("Never outside its own container")
 * for why it is clamped to it. Exported for its own tests: it is arithmetic on
 * two rectangles with no DOM in it, so it is the one part of this file's
 * geometry that can be asserted directly.
 *
 * The clamp is per axis because the guarantee is per axis. The stylesheet's
 * `min-height` makes the ordinary container at least as tall as the control,
 * so `Math.min` returns `size` and the result is byte-identical to an
 * unclamped one; there is no `min-width`, so a legitimately narrow empty
 * container — a column a few pixels wide — is the case that needs it.
 */
export function centeredControlRect(rect: Rect, size: number): Rect {
  const width = Math.min(size, rect.width);
  const height = Math.min(size, rect.height);
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

export interface EmptyContainerAppendersProps {
  /** The document to scan for containers with nothing in them. */
  document: BlockDocument;
  /** What each block type declares as its child regions. */
  slots: SlotSource;
  /**
   * Resolves a block type to its definition, for the control's accessible
   * name.
   *
   * An explicit resolver rather than the global registry: this keeps the
   * component testable against a fixture that registers nothing, and lets a
   * production caller hand it the very source the rest of the canvas already
   * reads from.
   */
  blocks: BlockLookup;
  /**
   * Raised with the container's node id when its control is pressed.
   *
   * This component decides only WHICH containers may be filled and draws the
   * control; it does not select anything or open an inserter itself. Turning
   * an id into a selection and an opened inserter is the caller's wiring, kept
   * out of here so this component's tests do not need a whole editor to exist.
   */
  onAppend: (nodeId: string) => void;
  /**
   * Suppress every control, for a host that is mid-gesture.
   *
   * Matches `BlockToolbar`: a drag is in the middle of changing the layout
   * these controls are drawn against, and a press during one would run an
   * insert against a container that is about to be somewhere else.
   */
  hidden?: boolean;
}

/**
 * One "+" per empty container, positioned over the element it would fill.
 */
export function EmptyContainerAppenders({
  document,
  slots,
  blocks,
  onAppend,
  hidden = false,
}: EmptyContainerAppendersProps): ReactElement | null {
  const layer = useRef<HTMLDivElement | null>(null);

  // WHICH containers get a control, decided from the document alone — see the
  // module docblock on why this must not wait on geometry to succeed.
  const containers = useMemo(
    () => emptyContainersIn(document, slots, blocks),
    [document, slots, blocks]
  );

  const [placements, setPlacements] =
    useState<ReadonlyMap<string, RecordedPlacement>>(NO_PLACEMENTS);

  /*
   * WHERE to draw each control, read through the same helper
   * `spacing-overlay.tsx` measures blocks with. `canvasContentRect` already
   * divides by the canvas root's own painted scale, so a control positioned
   * through it lands correctly whether the canvas is zoomed or not — this
   * file performs no scale arithmetic of its own, which is the point.
   */
  const measure = useCallback(() => {
    const element = layer.current;
    const root =
      element === null ? null : canvasRootFrom(element, CANVAS_ROOT_CLASS);
    if (root === null) {
      setPlacements(current => (current.size === 0 ? current : NO_PLACEMENTS));
      return;
    }
    const next = new Map<string, RecordedPlacement>();
    for (const container of containers) {
      const target = nodeElement(root, container.id);
      /*
       * DECLINED rather than left out. This pass HAS a canvas root and has
       * just searched it, so an id with no element is a container the render
       * does not produce — not one it has not produced yet. `PageRenderer`
       * drops whole subtrees before drawing anything: a node carrying
       * `visibility.conditions` is omitted from output, and so is one whose
       * props make it draw nothing. Neither ever reaches the DOM, however long
       * this waits, so recording nothing would leave a zero-sized button in
       * the tab order — announced by name, focusable, and pointing at content
       * that is not on the canvas.
       *
       * That leaves absence from the map meaning only "no pass has run",
       * which is the `root === null` return above and the one case where a
       * control genuinely is waiting to be placed.
       *
       * Re-decided on the next pass exactly like the three refusals below: a
       * container that starts rendering — a condition that begins to hold, an
       * edit that gives the node markup — gets its control back as soon as
       * anything re-measures.
       */
      if (target === null) {
        next.set(container.id, DECLINED);
        continue;
      }
      /*
       * The stylesheet's own condition, WHOLE, asked of the element the
       * stylesheet would ask it of — not a second condition computed here.
       *
       * `emptySlotOf` decided WHICH containers this component knows about,
       * from the document. That is a different population from the one
       * `builder-chrome.css` draws its 44px box for, and the module docblock
       * above depends on them being the same: a container the stylesheet
       * declined has no box, so a control centred in its measured rectangle is
       * centred in whatever that block happens to render instead. Both halves
       * of the rule produce that, and both are reachable:
       *
       * - the ELEMENT does not qualify. A closed `core/accordion-item` is the
       *   first-party case — an empty `children` slot inside a root that also
       *   renders a `<summary>`, so the root is not `:empty` and measures the
       *   summary's own height.
       * - the ANCESTORS do not qualify. `Canvas` and this component are both
       *   exported, so a host can compose them with no builder shell around
       *   them, and the rule's `.nx-builder-chrome` scope then never applies to
       *   any container in that canvas — every one of them sizeless, and every
       *   control drawn on one a focusable button with no area.
       *
       * `Element.matches` evaluates the ancestor combinators as well as the
       * compound, so one call covers the rule rather than the part of it that
       * happens to be about this element.
       */
      if (!target.matches(EMPTY_CONTAINER_SELECTOR)) {
        next.set(container.id, DECLINED);
        continue;
      }
      /*
       * Positioned against the VIEWPORT rather than against the page this
       * overlay draws in, which is a container no control can be anchored to.
       *
       * `position` is a catalog keyword, so `fixed` and `sticky` are values an
       * author stores like any other. Both hold the container still while the
       * canvas content under it travels, so the square measured here slides off
       * the container on the first scroll and comes to rest over unrelated
       * content — taking the presses meant for that content with it, since this
       * button is one of the two pieces of chrome that accept pointer events.
       *
       * Nothing corrects the drift, which is why it is refused instead of
       * re-measured: the shell scrolls a section ABOVE the canvas root and a
       * scroll event does not bubble, so `watchCanvasFor`'s capture-phase
       * listener on the root reaches a scroller nested INSIDE the canvas and
       * never hears that one.
       *
       * The same predicate `SpacingOverlay` refuses on, asked here rather than
       * `position` being read a second time — see `viewportPositioned` in
       * `geometry-dom.ts` for why that question belongs to the coordinate space
       * rather than to either overlay.
       */
      if (viewportPositioned(target)) {
        next.set(container.id, DECLINED);
        continue;
      }
      /*
       * Excluded outright rather than measured. `clippedByAncestorRect`
       * answers "is this element's own rectangle cut by an authored ancestor
       * between it and the root" — a clipped container's DOM is cut where
       * this overlay is not, so a control measured from its un-clipped
       * rectangle would be drawn over whatever the page actually shows at
       * that position.
       *
       * The RECT question rather than `clippedByAncestor`'s corner-aware one.
       * That refinement exists for a caller drawing chrome flush against a
       * block's edges — a spacing band runs the full length of one and does
       * reach the corners — and this control does not: it is a fixed square
       * anchored to the container's CENTRE, nowhere near a corner unless the
       * container itself is barely larger than the control. Measured against
       * an ordinary full-width child sitting flush inside a rounded, clipping
       * parent — `core/box` directly inside `core/card`, ordinary enough that
       * `card.tsx` names it the commonest composition in the library — the
       * two curves genuinely disagree by a few pixels at each corner, which
       * `clippedByAncestor` correctly reports and which is irrelevant to
       * anything drawn away from the corners. Asking the corner-aware
       * question here would decline the control for exactly the composition
       * an author reaches for most.
       */
      if (clippedByAncestorRect(target, root)) {
        next.set(container.id, DECLINED);
        continue;
      }
      const measured = canvasContentRect(target, root);
      next.set(container.id, {
        kind: "measured",
        rect: centeredControlRect(measured, APPENDER_SIZE_PX),
      });
    }
    setPlacements(next);
  }, [containers]);

  // Measured before paint, matching `BlockToolbar` and `SpacingOverlay`: a
  // control drawn at a stale rectangle for one frame is worse than one that
  // appears a frame late.
  useLayoutEffect(() => {
    if (hidden) return;
    measure();
    // `document` is not read directly by `measure`, and is listed anyway: an
    // edit can resize the container this control sits over without changing
    // which containers are empty, and a re-measure keyed on the container set
    // alone would keep describing the layout the container had before the
    // edit.
  }, [measure, hidden, document]);

  /*
   * Re-measure for the changes no render reports, all of them: a resize with
   * no render behind it (a breakpoint driven by the canvas's own width, a rail
   * panel opening, a webfont swapping in) and a move with no resize at all (a
   * scroller between the container and the root, a transition finishing on a
   * neighbour). Both move a control off the container it names, and the second
   * kind is invisible to every observer.
   *
   * A recompiled site sheet is the third kind and needs the same treatment: a
   * changed class rule moves an empty container while resizing nothing and
   * scrolling nothing, so only a mutation record reports it.
   *
   * `watchCanvasFor` owns the whole list rather than this file subscribing to
   * the part it happened to think of — which is exactly how the site-sheet case
   * came to be missing. The layer is handed over as a READ rather than as an
   * element, because it does not exist yet on the first pass. It is what
   * locates the canvas root, and it is also what tells a foreign mutation from
   * this overlay's own: drawing a control mutates the very subtree being
   * observed, so without it each measurement would schedule the next.
   */
  useEffect(() => {
    if (hidden || containers.length === 0) return;
    return watchCanvasFor(() => layer.current, measure);
  }, [measure, hidden, containers, document]);

  // `hidden` renders NOTHING, matching how `BlockToolbar` is suppressed during
  // a drag: a control that were merely invisible would still take a press, and
  // a press mid-drag would run an insert against a layout that is about to
  // move. Nothing to offer is the same answer: an empty overlay has no
  // controls to measure and nothing for a keyboard user to tab into.
  if (hidden || containers.length === 0) return null;

  return (
    <div
      ref={layer}
      className="nx-empty-container-appenders"
      // Marked as chrome so a press here resolves to this control rather than
      // to the canvas background. `canvas.tsx` documents the failure this
      // prevents: unmarked, a press on this overlay reads as a click on the
      // page, which CLEARS the selection this very press is about to make.
      {...{ [CHROME_ATTRIBUTE]: "" }}
    >
      {containers.map(container => {
        const rect = controlRectFor(placements, container.id);
        // A DECLINED container gets no button at all. A zero-sized one would
        // still be reachable by keyboard and announced by name, which is a
        // control an author can focus and never see — see the module docblock.
        if (rect === null) return null;
        return (
          <button
            key={container.id}
            type="button"
            className="nx-empty-container-appenders__button"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
            }}
            // The block's own name, so a control an author meets is one they
            // can find by searching for the thing it fills rather than for a
            // generic "add block" that says nothing about which container.
            aria-label={`Add a block to ${container.label}`}
            title={`Add a block to ${container.label}`}
            onClick={() => onAppend(container.id)}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
