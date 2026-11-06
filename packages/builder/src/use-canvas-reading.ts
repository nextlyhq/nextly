/**
 * What the CANVAS says about the selected node, read as one answer.
 *
 * Two questions are asked of the same element and they are asked together: the
 * tag it is drawn as, which decides whether an element-level rule such as the
 * typographic baseline reaches it, and the axes it runs on, which decide which
 * physical edge each logical side of a box is. Both are properties of the
 * rendered page rather than of the document, and neither can be answered from
 * the block type — `core/heading` picks its level from a prop, and writing mode
 * is inherited, so an ancestor or a site style can set it.
 *
 * ONE hook rather than two, and that is not tidiness. Asked separately they
 * attach two `MutationObserver`s to the same canvas and walk its marked
 * elements twice per commit to reach the same element, and the two answers can
 * be a render apart — the panel would then be drawing a box for one reading of
 * the selection while naming the tag from another.
 *
 * Its own module, and owned by the inspector WRAPPER rather than by the style
 * panel: the panel that decides which control shows a value should not also
 * hold a subscription to the DOM. Passed down as an answer, exactly as
 * `cascade` and `breakpoints` are.
 *
 * OBSERVED on two axes, and both are load-bearing. The canvas mounts only after styles have loaded while the
 * inspector stays mounted throughout, and a block whose `render` returns a
 * promise commits a Suspense fallback first and its real root later — in both
 * cases the marked element does not exist when an effect first runs. A one-shot
 * read would report the tag as unknown for the rest of the session, and the box
 * as unorientable, which is the state this whole tier exists to fix.
 *
 * @module use-canvas-reading
 */
import * as React from "react";

import type { EditorState } from "./editor-state";
import { observeRenderedTree } from "./rendered-tree";
import { orientationOfElement, type SideOrientation } from "./side-orientation";
import { markedElementOf } from "./style-subject";

/**
 * What the panel knows that can change the answer without moving an element.
 *
 * The axes are a COMPUTED property, so they move for reasons no mutation
 * reports: a forced state selects different rules, a breakpoint or preview
 * width changes which queries match, and new site styles change what is
 * inherited. None of those adds, removes or re-marks a node, and watching
 * attributes broadly is not open to us — `rendered-tree` records that both
 * observers here WRITE attributes inside the tree they watch, so a broad filter
 * re-enters for as long as the canvas is mounted.
 *
 * So the signals are taken from the panel, which already models every one of
 * them, rather than inferred from the DOM.
 *
 * One gap remains and is worth naming: a restyle from OUTSIDE this model — a
 * stylesheet swapped by the host, or an ancestor `dir` toggled by something
 * that is not the editor — is not covered, and the box keeps the previous axes
 * until anything else here changes. It is drawn from a reading that was true
 * when taken, which is the reason an unreadable orientation draws rows rather
 * than guessing.
 */
export interface RestyleSignals {
  /** The document, so a commit re-reads. */
  readonly document: EditorState["document"];
  /** The forced state being previewed, which selects a different rule set. */
  readonly state?: string | undefined;
  /** The breakpoint the canvas is sized to, which changes what queries match. */
  readonly breakpoint?: string | undefined;
  /** The site's compiled styles, which decide what the element inherits. */
  readonly cascade?: unknown;
  /** The container the preview is measured against, for the same reason. */
  readonly previewContainer?: string | undefined;
}

/** Everything the canvas can say about the selected node. */
export interface CanvasReading {
  /** The element the node is drawn as, lowercased, or `undefined` if not drawn. */
  readonly tag: string | undefined;
  /**
   * The element's writing mode and direction, or `undefined` if unreadable.
   *
   * `undefined` means NOT KNOWN rather than left-to-right, and a caller must
   * keep those apart: a box of logical sides drawn on an unknown orientation is
   * a positional claim with nothing behind it.
   */
  readonly orientation: SideOrientation | undefined;
  /**
   * The address of the picture the node draws, the node itself or the one
   * inside it (a link or a figure around an image), or `undefined` for none.
   * What the canvas really shows, so a control aimed at the picture (a focal
   * point) shows the same one.
   */
  readonly picture?: string | undefined;
  /** Where the canvas places that picture: its computed `object-position`. */
  readonly picturePosition?: string | undefined;
}

/**
 * Roots that hand their media styles to a picture inside them: a link or a
 * figure around an image, whatever else they hold (a caption).
 */
const PICTURE_WRAPPERS: ReadonlySet<string> = new Set([
  "A",
  "FIGURE",
  "PICTURE",
]);

/**
 * What the rich-text renderer draws a passage's pictures and galleries in:
 * its own figures, which a block's styles never reach, whether or not the
 * passage has words beside them.
 */
const RICH_TEXT_MEDIA = '[class*="nextly-rich-text"]';

/**
 * Whether an element shows words of its own, not of a block inside it.
 *
 * Text is what makes a root a passage: a picture among words is an inline one,
 * which no fit or focal point set on the passage reaches.
 */
function hasOwnText(element: Element): boolean {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT
  );
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const words = (node.textContent ?? "").trim() !== "";
    if (words && node.parentElement?.closest("[data-nx-node]") === element) {
      return true;
    }
  }
  return false;
}

/**
 * The image an element draws as its own picture, if it draws one.
 *
 * A link, a figure or a picture element hands its media styles on by design.
 * Any other root (a custom block's div or span around its picture) counts
 * only when that one picture is all it draws: a passage with an inline
 * picture styles its own root, and two pictures leave a single focal point
 * nothing to be aimed at.
 */
function ownImage(element: Element | undefined | null): Element | undefined {
  if (element == null) return undefined;
  if (element.tagName === "IMG") return element;
  // Its own, past any image a block inside it draws, and never one a
  // passage it holds draws.
  const owned = [...element.querySelectorAll("img")].filter(
    candidate =>
      candidate.closest("[data-nx-node]") === element &&
      candidate.closest(RICH_TEXT_MEDIA) === null
  );
  if (PICTURE_WRAPPERS.has(element.tagName)) return owned[0];
  return owned.length === 1 && !hasOwnText(element) ? owned[0] : undefined;
}

/** Where the canvas places a picture, as its window computes it. */
function positionOf(image: Element | undefined): string | undefined {
  if (image === undefined) return undefined;
  const view = image.ownerDocument.defaultView;
  const position = view?.getComputedStyle(image).objectPosition;
  return position === undefined || position === "" ? undefined : position;
}

/** The address a picture shows: the source it chose, else the one it names. */
function addressOf(image: Element | undefined): string | undefined {
  if (image === undefined) return undefined;
  const shown =
    (image as HTMLImageElement).currentSrc || image.getAttribute("src");
  return shown === null || shown === "" ? undefined : shown;
}

/** Nothing known yet, shared so an unchanged reading keeps its identity. */
const NOTHING: CanvasReading = { tag: undefined, orientation: undefined };

/** Whether two readings say the same thing, so state is left alone when they do. */
function same(a: CanvasReading, b: CanvasReading): boolean {
  return (
    a.tag === b.tag &&
    a.picture === b.picture &&
    a.picturePosition === b.picturePosition &&
    a.orientation?.writingMode === b.orientation?.writingMode &&
    a.orientation?.direction === b.orientation?.direction &&
    // The layout too: alignment icons follow it, and it can change alone.
    a.orientation?.display === b.orientation?.display &&
    a.orientation?.flexDirection === b.orientation?.flexDirection
  );
}

/**
 * Read the selected node's tag and axes from the canvas, keeping them current.
 *
 * @param canvasRoot - the canvas root the page is drawn under
 * @param selectedId - the block being edited
 * @param document - the editor's document, so a commit re-reads
 * @returns the tag and orientation, each `undefined` when unreadable
 */
export function useCanvasReading(
  canvasRoot: HTMLElement | null | undefined,
  selectedId: string | null,
  restyledBy: RestyleSignals
): CanvasReading {
  const { document, state, breakpoint, cascade, previewContainer } = restyledBy;
  const [reading, setReading] = React.useState<CanvasReading>(NOTHING);

  React.useEffect(() => {
    /*
     * ONE walk for both answers. `markedElementOf` compares ids as strings over
     * the marked elements rather than building a selector, because a node id is
     * author data and `querySelector` throws on invalid syntax instead of
     * missing — so finding the element twice would also be paying that walk
     * twice.
     *
     * Compared by VALUE before storing, here and in the observer: the canvas
     * mutates on every keystroke that reaches it, and storing a fresh object
     * each time would re-render the whole inspector per character for an answer
     * that had not moved.
     */
    const read = () => {
      const element = markedElementOf(canvasRoot, selectedId);
      // Found once: the address and the placement are of the same picture.
      const image = ownImage(element);
      const next: CanvasReading = {
        tag: element?.tagName.toLowerCase(),
        orientation: orientationOfElement(element),
        picture: addressOf(image),
        picturePosition: positionOf(image),
      };
      setReading(current => (same(current, next) ? current : next));
    };
    read();

    if (canvasRoot == null) return;
    const stopTree = observeRenderedTree(canvasRoot, read);
    /*
     * Also on RESIZE, because the axes can change with nothing in the tree
     * moving at all. Writing mode and direction are inherited and can be set by
     * a media or container query, so dragging the canvas across one of its own
     * breakpoints changes the answer while adding, removing and re-marking no
     * element — and the tree observer, which watches structure and the node id,
     * has nothing to report. The box would then keep pointing at the edges the
     * previous width implied.
     *
     * The canvas itself is the box being measured, so its own resize is the
     * event: a query that matters here is answered by the canvas's width, and
     * the admin window changing without the canvas changing cannot alter what a
     * rule inside it matched.
     */
    // From the canvas's own window: a canvas rendered in a frame is laid out
    // by that frame, the realm its observer has to come from.
    const Sizes = canvasRoot.ownerDocument.defaultView?.ResizeObserver;
    const sizes = typeof Sizes === "function" ? new Sizes(read) : undefined;
    sizes?.observe(canvasRoot);
    return () => {
      stopTree?.();
      sizes?.disconnect();
    };
    /*
     * Every dependency here is something that can RESTYLE the page without
     * moving an element, which is the class of change no observer above can
     * see. A forced state applies a different rule set; a breakpoint or preview
     * width changes which queries match; new site styles change what is
     * inherited. Each is already modelled by the panel, so the axes are re-read
     * from the signal rather than from a guess about the DOM.
     */
  }, [
    canvasRoot,
    selectedId,
    document,
    state,
    breakpoint,
    cascade,
    previewContainer,
  ]);

  return reading;
}
