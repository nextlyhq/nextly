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
 * For the ordinary case — a block declaring one slot, empty — this changes
 * nothing an author can see: `builder-chrome.css`'s `[data-nx-slots]:empty`
 * rule already gives such a container a 44px box, so centring a 44px square
 * inside its own measured rectangle places the control exactly where that box
 * already is.
 *
 * ## Identity is independent of geometry, and has to stay that way
 *
 * Which containers get a control comes from the DOCUMENT alone. Position is a
 * later, separate refinement of WHERE to draw something that already exists:
 * a control an author cannot yet see on screen — because the canvas root has
 * not mounted, or a resize has not settled — is still a control a screen
 * reader can reach, and a test asserting it exists must not depend on a
 * browser having laid anything out. So an unmeasured control here keeps its
 * geometry at `{ x: 0, y: 0, width: 0, height: 0 }` rather than being hidden:
 * hiding it would remove it from the accessibility tree, which is exactly the
 * state every test in `empty-container-appender.test.tsx` renders in — a
 * bare component with no canvas root at all — so a hidden-until-measured
 * design would make every one of those tests fail to find a control that,
 * mounted for real, is there all along.
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

import {
  CANVAS_ROOT_CLASS,
  CHROME_ATTRIBUTE,
  nodeElement,
  nodeElements,
} from "./canvas";
import { emptySlotOf } from "./empty-slot";
import type { Rect } from "./geometry";
import {
  canvasContentRect,
  canvasRootFrom,
  clippedByAncestorRect,
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
 * all — see the module docblock for why it must render regardless.
 */
const UNMEASURED_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** No controls: the identity returned before the first measurement runs. */
const NO_RECTS: ReadonlyMap<string, Rect> = new Map();

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
 * A fixed {@link APPENDER_SIZE_PX} square, centred inside a larger rectangle.
 *
 * See the module docblock ("A fixed, centred square") for why the button is
 * never sized to the measured rectangle itself.
 */
function centeredControlRect(rect: Rect, size: number): Rect {
  return {
    x: rect.x + (rect.width - size) / 2,
    y: rect.y + (rect.height - size) / 2,
    width: size,
    height: size,
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

  const [rects, setRects] = useState<ReadonlyMap<string, Rect>>(NO_RECTS);

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
      setRects(current => (current.size === 0 ? current : NO_RECTS));
      return;
    }
    const next = new Map<string, Rect>();
    for (const container of containers) {
      const target = nodeElement(root, container.id);
      if (target === null) continue;
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
      if (clippedByAncestorRect(target, root)) continue;
      const measured = canvasContentRect(target, root);
      next.set(container.id, centeredControlRect(measured, APPENDER_SIZE_PX));
    }
    setRects(next);
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
   * Re-measure for a resize no render reports: a breakpoint driven by the
   * canvas's own width, a rail panel opening, a webfont swapping in.
   *
   * EVERY rendered node is observed, not only the containers this overlay
   * draws a control for — matching `SpacingOverlay`, which observes the same
   * way for the same reason: what moves a container is often a SIBLING
   * changing size rather than the container itself. An image finishing its
   * load resizes that sibling and nothing else — not the empty container
   * beside it, and not the root, which is `min-height: 100%` and can absorb
   * the change while reporting nothing. An observer scoped to only the found
   * containers never fires for that resize, and the control is left drawn
   * over the coordinates the layout had before it.
   */
  useEffect(() => {
    if (hidden || containers.length === 0) return;
    const element = layer.current;
    const root =
      element === null ? null : canvasRootFrom(element, CANVAS_ROOT_CLASS);
    if (root === null) return;
    // Absent in jsdom unless a test supplies one, and absent in older
    // browsers. A missing observer costs a re-measure, not correctness —
    // every render path above still measures.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    for (const node of nodeElements(root)) observer.observe(node);
    return () => observer.disconnect();
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
        const rect = rects.get(container.id) ?? UNMEASURED_RECT;
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
