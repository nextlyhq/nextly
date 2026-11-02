/**
 * Bring one block into view by its id.
 *
 * One answer for every way an author asks the editor to show a block: opening
 * the editor at a section from the entry screen, a Layers row, a search
 * result. Each of those would otherwise find the element and scroll it its own
 * way, and the copies drift — one animating for a reader who asked for less
 * motion, another finding a same-id node outside the canvas.
 *
 * ## It searches the root it is handed
 *
 * Never the global `document`. The entry screen's preview draws the same
 * document beside the editor, so the same ids exist twice on one screen, and a
 * canvas drawn inside a frame keeps its nodes in the frame's own document,
 * where a global search finds nothing. The caller says where the canvas is.
 *
 * ## The node is found the way the canvas finds it
 *
 * Through `nodeElement`, the canvas's own map from a node id to the element it
 * was drawn as. That answers for a placed component too: the instance the
 * editor holds draws no element of its own, and its definition's elements
 * carry minted ids with the instance named beside them. A second lookup here
 * would be a second answer to what a node id means in the DOM.
 *
 * @module reveal-node
 */
import { nodeElement } from "./canvas";

/**
 * Whether the reader asked the system for less motion, asked of the window the
 * root belongs to — a frame's window answers for the frame.
 */
function prefersReducedMotion(root: Document | HTMLElement): boolean {
  const owner = "defaultView" in root ? root : root.ownerDocument;
  const view = owner.defaultView;
  if (view === null || typeof view.matchMedia !== "function") return false;
  return view.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Scroll the block `id` into view inside `root`.
 *
 * `nearest` on both axes, so a block already on screen does not move and one
 * off screen moves only as far as it must. Smooth, except where the reader
 * asked for less motion, where it jumps.
 *
 * @param root - the canvas: its root element, or the document of the frame it
 *   draws in
 * @param id - the block's id, as the document stores it
 * @returns whether the block was found; `false` scrolls nothing, which is what
 *   an address naming a block the page no longer has should do
 */
export function revealNode(root: Document | HTMLElement, id: string): boolean {
  // A frame's document is searched from its root element, which holds all of
  // it; `nodeElement` compares ids rather than building a selector from them.
  const scope = "documentElement" in root ? root.documentElement : root;
  const element = nodeElement(scope, id);
  if (element === null) return false;
  element.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: prefersReducedMotion(root) ? "auto" : "smooth",
  });
  return true;
}
