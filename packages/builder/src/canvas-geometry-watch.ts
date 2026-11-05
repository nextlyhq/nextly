/**
 * The one subscription that answers "a node's rectangle may have moved".
 *
 * Every overlay drawn in the canvas's content coordinates — the spacing bands,
 * the empty-container appenders — measures the nodes it draws over and has to
 * re-measure whenever the layout underneath it changes. React reports the
 * changes that come from a render; nothing reports the rest, and the rest is
 * several different mechanisms that no single browser API covers:
 *
 * - a SIZE change with no render behind it: a container query resolving at a
 *   new canvas width, a rail panel opening, a webfont swapping in, an image
 *   finishing its load. `ResizeObserver` is the only thing that sees these.
 * - a MOVE with no size change at all: a scroller between a node and the root,
 *   or a transition finishing on a neighbour. No observer reports either,
 *   because nothing resized, nothing mutated and no element the overlay knows
 *   about changed at all.
 *
 * Held here rather than written out per overlay because the drift is otherwise
 * silent and has already happened: one overlay subscribed to resizes and not
 * to scrolls, and its controls stayed at the coordinates the layout had before
 * the author scrolled a container — while the file looked like a complete copy
 * of the one beside it. A caller that asks this question asks all of it.
 *
 * A `MutationObserver` answers a THIRD question — the DOM changed, which alters
 * computed style without necessarily altering any size. It needs something the
 * other two do not, because the subtree it observes CONTAINS the overlay's own
 * output: where that output is, which only the overlay knows.
 *
 * {@link watchCanvasFor} is therefore the entry point and all three are behind
 * it, taking the one thing a caller has to supply. Offering the mechanisms
 * separately would put "did I remember to take all of them" back on each
 * overlay, which is the failure this module was extracted to remove and which
 * happened again the moment there were two subscriptions to remember instead of
 * one — an overlay took the geometry half, left the mutation half out, and its
 * controls stayed where a recompiled site sheet had moved the blocks from.
 *
 * @module canvas-geometry-watch
 */

import { isEditableText, isTextEntry } from "./canvas-escape";
import { isElement, isFormField } from "./dom-kind";
import {
  overlaySpaceOf,
  screenScrollers,
  scrollEventTarget,
} from "./geometry-dom";
import { nodeElements, nodeElementsIn } from "./rendered-nodes";
import { CANVAS_ROOT_CLASS } from "./shell-state";

/**
 * Marks a layer the editor draws OVER the page — absolutely positioned and
 * taking no part in layout — whose own redrawing can move no block.
 *
 * Every overlay's watch ignores what happens inside one, not only the caller's
 * own: one overlay drawing would otherwise make every other re-measure, for a
 * change that cannot have moved anything they measure.
 */
export const OVERLAY_OUTPUT_ATTRIBUTE = "data-nx-overlay-output";

/** Whether a mutated node sits inside a layer marked as overlay output. */
function insideOverlayOutput(target: Node): boolean {
  const element = isElement(target) ? target : target.parentElement;
  return element?.closest(`[${OVERLAY_OUTPUT_ATTRIBUTE}]`) != null;
}

/**
 * Everything an overlay drawn over this canvas has to re-measure for.
 *
 * ONE call rather than a list a caller assembles: which changes can move a
 * rectangle is a single question, and an overlay that answers part of it looks
 * exactly like one that answers all of it — the file reads as complete and the
 * controls are simply stale under whichever mechanism was left out.
 *
 * The canvas root is resolved FROM the layer rather than passed in, so a caller
 * cannot subscribe against one root while drawing into another; `undefined`
 * comes back when there is none, which is an overlay mounted outside a canvas
 * and has nothing to watch.
 *
 * @param ownLayer - reads the caller's own layer element, and is read rather
 *   than passed because the layer does not exist until after the first render;
 *   it locates the canvas AND says which mutations are the caller's own
 * @param moved - re-measure; called once per change, never per frame
 * @returns unsubscribes everything this installed, or `undefined` when there
 *   was no canvas root to install anything on
 */
export function watchCanvasFor(
  ownLayer: () => HTMLElement | null,
  moved: () => void
): (() => void) | undefined {
  const element = ownLayer();
  // The root the layer is drawn over: its ancestor when the canvas shares the
  // layer's document, the root in the frame the layer is drawn over otherwise.
  const root =
    element === null
      ? null
      : (overlaySpaceOf(element, CANVAS_ROOT_CLASS)?.root ?? null);
  if (root === null) return undefined;
  const geometry = watchCanvasGeometry(root, moved);
  const styles = watchCanvasStyleMutations(root, ownLayer, moved);
  return () => {
    geometry();
    styles();
  };
}

/**
 * Call `moved` whenever the canvas's laid-out geometry may have changed.
 *
 * @param root - the canvas root every node is measured against
 * @param moved - re-measure; called once per change, never per frame
 * @returns unsubscribes everything this installed
 */
function watchCanvasGeometry(root: HTMLElement, moved: () => void): () => void {
  /*
   * EVERY rendered node is observed, not only the ones a caller draws over:
   * what moves a node is often a SIBLING changing size rather than the node
   * itself. An image finishing its load resizes that sibling and nothing else
   * — not the node laid out after it, and not the root, which is
   * `min-height: 100%` and can absorb the change while reporting nothing.
   *
   * The root is observed too, for the resize the nodes cannot report: the
   * panels around the canvas moving, which changes the frame without changing
   * any node.
   *
   * Absent in jsdom unless a test supplies one, and absent in older browsers.
   * Guarded on its own rather than gating the listeners below, because the two
   * answer different questions: a runtime missing the observer must still hear
   * a scroll. A missing observer costs a re-measure, not correctness — every
   * caller measures on render as well.
   *
   * Built from the ROOT's window, the realm of everything it observes: a
   * canvas rendered in a frame is laid out by that frame, and an observer from
   * another window is not guaranteed to report on its nodes.
   */
  const view = root.ownerDocument.defaultView;
  const Sizes = view?.ResizeObserver;
  const sizes = typeof Sizes === "function" ? new Sizes(() => moved()) : null;
  if (sizes !== null) {
    sizes.observe(root);
    for (const node of nodeElements(root)) sizes.observe(node);
  }
  /*
   * And every node that arrives LATER, which the snapshot above cannot see: a
   * block that resolves after a Suspense fallback, or one an edit inserts. Its
   * insertion is heard as a mutation and measured then, but an image loading
   * inside it afterwards resizes only that block — no ancestor need change —
   * so unobserved, nothing would report it. A node leaving is released, so the
   * observer does not hold elements the page no longer has.
   */
  const Arrivals = view?.MutationObserver;
  const arrivals =
    sizes === null || typeof Arrivals !== "function"
      ? null
      : new Arrivals(records => {
          for (const record of records) {
            record.addedNodes.forEach(added => {
              if (!isElement(added)) return;
              for (const node of nodeElementsIn(added)) sizes.observe(node);
            });
            record.removedNodes.forEach(removed => {
              if (!isElement(removed)) return;
              for (const node of nodeElementsIn(removed)) sizes.unobserve(node);
            });
          }
        });
  arrivals?.observe(root, { childList: true, subtree: true });

  /*
   * `overflow: auto` and `overflow: scroll` are catalog values, so a block can
   * sit inside a container the author scrolls. Scrolling it moves the block
   * relative to the canvas while resizing nothing, mutating nothing and
   * finishing no transition — none of the observers above hear it.
   *
   * CAPTURE, because a scroll event does not bubble: listening on the root in
   * the capture phase is what reaches a scroller nested anywhere inside it.
   *
   * `transition` is a catalog property too, and a transform or margin
   * animating past its first frame moves a block while resizing nothing. The
   * completion events are what the browser offers, and they DO bubble, so one
   * listener each on the root covers every block. This corrects the FINAL
   * geometry rather than following the animation: tracking the frames between
   * would mean measuring on every one, which costs more than an overlay being
   * briefly behind a transition the author is watching.
   *
   * `animation` likewise: an entrance motion or a site's `@keyframes` moves a
   * block by transform, and its end and cancel bubble the same way. A block
   * animating FOREVER never ends; its marks follow the geometry of the last
   * measurement, re-taken whenever anything else re-measures, rather than
   * chasing every frame — `animationiteration` would re-measure at whatever
   * point of the motion each loop boundary falls, which moves the ring without
   * making it right.
   */
  const settled = (): void => moved();
  root.addEventListener("transitionend", settled);
  root.addEventListener("transitioncancel", settled);
  root.addEventListener("animationend", settled);
  root.addEventListener("animationcancel", settled);
  /*
   * An authored `:hover` or `:focus-visible` rule can move a block — a
   * transform, a margin — with no transition, so the change of state is the
   * only signal there is. Pointer and focus entering or leaving a block
   * bubble, so the root hears every block's. Measured on the next frame,
   * once the state's styles apply, and once per frame however many changes
   * arrive in it: a pointer crossing the page enters and leaves many blocks.
   */
  let frame: number | undefined;
  const restated = (): void => {
    if (frame !== undefined) return;
    if (view === null || typeof view.requestAnimationFrame !== "function") {
      moved();
      return;
    }
    frame = view.requestAnimationFrame(() => {
      frame = undefined;
      moved();
    });
  };
  /*
   * Hover and focus entering or leaving a block, and a press ending. The
   * input modality, which `:focus-visible` can follow with no focus event at
   * all, is heard by the key and pointer listeners below.
   */
  const STATE_EVENTS = [
    "pointerover",
    "pointerout",
    "focusin",
    "focusout",
    // A press ending ends an authored `:active` state, with no pointer
    // leaving and no focus changing.
    "pointerup",
    "pointercancel",
  ];
  for (const type of STATE_EVENTS) root.addEventListener(type, restated);
  /*
   * A value can change with no DOM mutation: a form field's, or a custom
   * element's kept in script, and either can change what `:valid`,
   * `:invalid`, `:placeholder-shown` or a custom state styles. So every
   * `input` and `change` re-measures, with ONE exception: editable text in
   * the canvas's own tree, whose edits mutate the DOM, which the mutation
   * watch already measures — hearing its `input` too would measure every
   * character twice. An edit inside a custom element's shadow root is a
   * mutation no observer on the root sees, so it is not the exception.
   *
   * Read from the composed path, whose first entry is the element the edit
   * reached: `target` is retargeted to the shadow host by the time the event
   * reaches the root.
   */
  const valueChanged = (event: Event): void => {
    const origin = event.composedPath()[0] ?? event.target;
    // The editing host itself, the element carrying `contenteditable`, is
    // where a browser fires an edit's `input`. A control nested in editable
    // text that dispatches on itself inherits editability without being one,
    // and its value can change with no mutation at all.
    const mutatesOurTree =
      isElement(origin) &&
      !isFormField(origin) &&
      origin.hasAttribute("contenteditable") &&
      origin.getRootNode() === root.getRootNode() &&
      isEditableText(origin);
    if (!mutatesOurTree) restated();
  };
  root.addEventListener("input", valueChanged);
  root.addEventListener("change", valueChanged);
  /*
   * The keyboard is heard for what it can change, not for every key: an
   * author typing would otherwise re-measure every overlay once a frame. A
   * key changes what a style reads when it is the first after a pointer (the
   * modality, which `:focus-visible` follows), or when it activates a
   * control — Space or Enter down and up, outside editable text — which
   * `:active` follows. A pointer press is always a change: it starts
   * `:active`, and hands the modality back to the pointer.
   */
  let modality: "keyboard" | "pointer" | undefined;
  const activates = (event: Event): boolean => {
    // Read by shape: a canvas in a frame dispatches the frame's own
    // KeyboardEvent, which no `instanceof` against this window matches.
    const key = "key" in event ? event.key : undefined;
    if (key !== " " && key !== "Enter") return false;
    // Text entry is the one place these keys activate nothing; a checkbox,
    // a radio or a button the keyboard presses is a control, as Escape's
    // own reading of the canvas already tells them apart.
    const target = event.target;
    return !(isElement(target) && isTextEntry(target));
  };
  const keyDown = (event: Event): void => {
    if (modality !== "keyboard") {
      modality = "keyboard";
      restated();
    } else if (activates(event)) {
      restated();
    }
  };
  const keyUp = (event: Event): void => {
    if (activates(event)) restated();
  };
  const pointerDown = (): void => {
    modality = "pointer";
    restated();
  };
  root.addEventListener("keydown", keyDown);
  root.addEventListener("keyup", keyUp);
  root.addEventListener("pointerdown", pointerDown);
  root.addEventListener("scroll", settled, true);
  /*
   * And the root's DOCUMENT, in the bubble phase, for the viewport itself
   * scrolling. A canvas in a frame of its own is scrolled by that frame's
   * viewport, and a viewport's scroll is dispatched at the document, which no
   * listener on the root can hear. Not in the capture phase: that would hear
   * every element's scroll anywhere in the document, which the listener above
   * already covers for the ones inside the canvas.
   */
  const doc = root.ownerDocument;
  doc.addEventListener("scroll", settled);

  return () => {
    sizes?.disconnect();
    arrivals?.disconnect();
    root.removeEventListener("transitionend", settled);
    root.removeEventListener("transitioncancel", settled);
    root.removeEventListener("animationend", settled);
    root.removeEventListener("animationcancel", settled);
    for (const type of STATE_EVENTS) root.removeEventListener(type, restated);
    root.removeEventListener("input", valueChanged);
    root.removeEventListener("change", valueChanged);
    root.removeEventListener("keydown", keyDown);
    root.removeEventListener("keyup", keyUp);
    root.removeEventListener("pointerdown", pointerDown);
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    root.removeEventListener("scroll", settled, true);
    doc.removeEventListener("scroll", settled);
  };
}

/**
 * What each attribute held BEFORE this batch, or `undefined` if the batch
 * carries anything that is not an attribute change.
 *
 * The FIRST record for an attribute is the one holding its pre-batch value; a
 * later record for the same attribute reports an intermediate one.
 */
interface AttributeBefore {
  /**
   * Kept because `attributeName` is the LOCAL name.
   *
   * A namespaced attribute — `xlink:href` on an SVG `<use>`, say — is reported
   * as `href`, and `getAttribute("href")` answers `null` for it however it was
   * set. Reading it back by local name alone therefore asks about a DIFFERENT
   * attribute, one that is usually absent, so `null` matches `null` and every
   * namespaced change passes as no change at all.
   */
  readonly namespace: string | null;
  readonly name: string;
  readonly was: string | null;
}

function beforeBatch(
  records: readonly MutationRecord[]
): Map<Element, Map<string, AttributeBefore>> | undefined {
  const before = new Map<Element, Map<string, AttributeBefore>>();
  for (const record of records) {
    const name = record.attributeName;
    if (record.type !== "attributes" || name === null) return undefined;
    // A node this can read an attribute off, asked without naming a realm.
    if (!isElement(record.target)) return undefined;
    const namespace = record.attributeNamespace;
    const byName =
      before.get(record.target) ?? new Map<string, AttributeBefore>();
    const key = `${namespace ?? ""}\u0000${name}`;
    if (!byName.has(key))
      byName.set(key, { namespace, name, was: record.oldValue });
    before.set(record.target, byName);
  }
  return before;
}

/**
 * Whether this batch left the subtree exactly as it found it.
 *
 * An overlay that MEASURES by writing has to write into the subtree it is
 * watching: the spacing probe pushes a value, reads the edge and puts the
 * attribute back, all inside one task. Reacting to that would have every
 * measurement schedule the next one forever. Remembering an answer across
 * measurements avoids that and buys a staleness of its own, since the applied
 * CSS changes for reasons nothing here reports. Ignoring a batch that changed
 * nothing removes the need to choose between the two.
 *
 * Judged across the WHOLE batch rather than per record, because per record the
 * restore looks like a change: its `oldValue` is the value the probe wrote,
 * while the attribute now holds the original. Only the first `oldValue` for an
 * attribute describes what it held before any of this, and comparing THAT with
 * what it holds now is the net question.
 *
 * A batch carrying a `childList` or `characterData` record changed something by
 * construction, and is never filtered.
 */
function changedNothing(records: readonly MutationRecord[]): boolean {
  const before = beforeBatch(records);
  if (before === undefined) return false;
  for (const [target, byName] of before) {
    for (const [, { namespace, name, was }] of byName) {
      if (target.getAttributeNS(namespace, name) !== was) return false;
    }
  }
  return true;
}

/**
 * Call `moved` when a mutation OUTSIDE the caller's own output lands in the
 * canvas.
 *
 * The change this reaches and {@link watchCanvasGeometry} cannot: a recompiled
 * site sheet. `PageRenderer` emits the sheet as a `<style>` inside the page
 * root, so a save mutates this subtree — and a class-driven margin, position or
 * transform then moves blocks while resizing nothing, scrolling nothing and
 * finishing no transition. Every subscription in the function above stays
 * silent, and an overlay drawn over one of those blocks keeps the coordinates
 * the old rule gave it until something else re-measures.
 *
 * SEPARATE from that function rather than folded into it, and this is the part
 * a caller has to supply. An overlay draws INTO the subtree being observed, so
 * every measurement mutates it — a control appearing or leaving is a
 * `childList` record, a new rectangle rewrites a `style` attribute — and an
 * observer that reacted to those would have each measurement schedule the next.
 * Which mutations are the caller's own is therefore not answerable here, which
 * is why it is an argument rather than a rule written into this module.
 *
 * The test applied to that answer IS shared, because both overlays give the
 * same one: a full-bleed layer of their own, so containment within it decides
 * ownership exactly. An overlay that drew into the page itself — inline
 * chrome attached to a block rather than a layer above it — could not be
 * answered by containment and should not use this.
 *
 * @param root - the canvas root whose subtree is watched
 * @param ownOutput - the caller's own layer, read at delivery time because it
 *   does not exist when the subscription is taken
 * @param moved - re-measure; called once per batch of foreign mutations
 * @returns unsubscribes
 */
function watchCanvasStyleMutations(
  root: HTMLElement,
  ownOutput: () => HTMLElement | null,
  moved: () => void
): () => void {
  // Absent in jsdom unless a test supplies one, and absent in older browsers.
  // A missing observer costs a re-measure rather than correctness: every caller
  // measures on render as well. From the root's window, the realm of the
  // subtree it watches.
  const Mutations = root.ownerDocument.defaultView?.MutationObserver;
  if (typeof Mutations !== "function") return () => {};
  const styles = new Mutations(records => {
    const own = ownOutput();
    /*
     * `own === null` counts as OUTSIDE rather than as the caller's own. The
     * layer is null only once the caller has unmounted, and an unmounted
     * overlay owns nothing in this subtree; treating it as own-output would
     * silently drop a real site-style change in any window where the reference
     * were momentarily unset.
     */
    /*
     * The foreign records are separated rather than counted, because the net
     * question below has to be asked of THOSE alone. One batch can carry both:
     * the overlay redraws its own layer in the same task as a probe writes to a
     * block and puts it back, and judging the whole batch then finds the
     * layer's `childList` records and reports a change the caller caused.
     */
    const foreign = records.filter(
      record =>
        (own === null || !own.contains(record.target)) &&
        !insideOverlayOutput(record.target)
    );
    if (foreign.length > 0 && !changedNothing(foreign)) moved();
  });
  /*
   * Every kind of record, because every kind can carry a new rule: a sheet
   * being replaced is `childList`, a sheet's bytes changing in place is
   * `characterData`, and a class or inline style moving on a block is
   * `attributes`. `subtree` because the sheet sits inside the page root rather
   * than beside it.
   */
  styles.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    // What each attribute held before, which is what makes a net-zero batch
    // recognisable. See {@link changedNothing}.
    attributeOldValue: true,
    characterData: true,
  });
  return () => styles.disconnect();
}

/**
 * Call `moved` whenever what of the canvas is on screen may have changed:
 * a scroll of the canvas's own scroller or of the host's around its frame,
 * either one resizing, or a window resizing. Chrome kept to the screen band
 * (the block toolbar, the marks' tags) re-measures for all of them.
 *
 * One subscription rather than each consumer listening for its own share, for
 * the reason this module exists: an overlay that heard the scrolls and not
 * the resizes looked complete and stayed where a resized panel had left the
 * band. A scroller's scroll is heard where it is dispatched
 * (`scrollEventTarget`): a document's scrolling element scrolls at its
 * document, never at itself.
 *
 * @param root - the canvas root the band is read for
 * @param frame - the frame the canvas is drawn in, or `null`
 * @param moved - re-measure; called once per change
 * @returns unsubscribes everything this installed
 */
export function watchScreenBand(
  root: HTMLElement,
  frame: HTMLIFrameElement | null,
  moved: () => void
): () => void {
  const changed = (): void => moved();
  const stops: (() => void)[] = [];
  const views = new Set<Window>();
  for (const scroller of screenScrollers(root, frame)) {
    const source = scrollEventTarget(scroller);
    source.addEventListener("scroll", changed, { passive: true });
    stops.push(() => source.removeEventListener("scroll", changed));
    const view = scroller.ownerDocument.defaultView;
    if (view === null) continue;
    views.add(view);
    // Absent in jsdom unless a test supplies one, and in older browsers: a
    // missing observer costs a re-measure, not correctness.
    const Sizes = view.ResizeObserver;
    if (typeof Sizes !== "function") continue;
    const sizes = new Sizes(changed);
    sizes.observe(scroller);
    stops.push(() => sizes.disconnect());
  }
  for (const view of views) {
    view.addEventListener("resize", changed);
    stops.push(() => view.removeEventListener("resize", changed));
  }
  return () => {
    for (const stop of stops) stop();
  };
}
