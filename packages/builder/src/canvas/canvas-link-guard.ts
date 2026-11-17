/**
 * The canvas never leaves the editor.
 *
 * The canvas draws the page as it will be published, so its links are real
 * anchors and its forms real forms. A click on one is how an author selects
 * that block, and the browser's own default for the same click is to follow
 * the link or submit the form: the editor navigated away mid-edit, to whatever
 * the link named, with every unsaved change at risk. Selection and the
 * browser's default are two separate consequences of one event, so the guard
 * cancels the default and leaves the event itself alone: every handler that
 * selects, drags or opens a menu still receives it.
 *
 * ## What it covers
 *
 * - `click` inside a link, which also covers Enter on a focused link (the
 *   browser activates a link from the keyboard by dispatching a click) and
 *   a modified click that would open a new tab or window;
 * - `auxclick`, the middle button, which opens a new tab without any `click`;
 * - `submit` from a form inside the canvas, however it was triggered. A
 *   submit is also stopped from propagating: a block's own script may send
 *   the real request from its submit handler, which cancelling the browser's
 *   default alone does not prevent. Nothing in the editor listens for a
 *   submit; selection comes from the click that preceded it.
 *
 * The editor's own chrome drawn inside the root (the toolbar, an overlay a
 * host adds) is not the page, so its links keep working.
 *
 * ## Listening on the canvas's own document
 *
 * The listeners go on the document that OWNS the canvas root, in the capture
 * phase, and act only on events whose target is inside the root. The owner
 * rather than the global `document`, so a canvas drawn inside a frame is
 * guarded in that frame's document too; capture, so nothing inside the canvas
 * that stops propagation can stop the guard. Nodes are recognised by
 * `nodeType` and `closest` rather than `instanceof`, because a node from a
 * frame is not an instance of this window's constructors.
 *
 * @module canvas-link-guard
 */

/** The events whose default can navigate: see the module notes. */
const GUARDED = ["click", "auxclick", "submit"] as const;

/** The anchors a click follows: a link or an image-map area with an address. */
const FOLLOWED = "a[href], area[href]";

/** The element an event started at, or null for one that is not in a page. */
function elementOf(target: EventTarget | null): Element | null {
  if (target === null || !("nodeType" in target)) return null;
  const node = target as Node;
  if (node.nodeType === 1) return node as Element;
  // A click on a link's text arrives at the text node, not the anchor.
  return node.parentElement;
}

/** Whether an event's default would take the page somewhere else. */
function navigates(event: Event, root: Element, chrome: string): boolean {
  const element = elementOf(event.target);
  if (element === null || !root.contains(element)) return false;
  if (element.closest(chrome) !== null) return false;
  if (event.type === "submit") return true;
  return element.closest(FOLLOWED) !== null;
}

/**
 * Stops every link and form inside `root` from navigating, and answers the
 * function that stops guarding.
 *
 * Call it once per mounted canvas root; the root is the boundary, so a link
 * in the editor's own chrome outside it still works. `chrome` is the selector
 * that marks the editor's chrome drawn INSIDE the root, which is left alone
 * too. It is passed in rather than imported, because the canvas that owns the
 * marker is the module that installs this guard.
 */
export function guardCanvasNavigation(
  root: HTMLElement,
  chrome: string
): () => void {
  const owner = root.ownerDocument;
  const guard = (event: Event): void => {
    if (!navigates(event, root, chrome)) return;
    event.preventDefault();
    if (event.type === "submit") event.stopPropagation();
  };
  for (const type of GUARDED) {
    owner.addEventListener(type, guard, true);
  }
  return () => {
    for (const type of GUARDED) {
      owner.removeEventListener(type, guard, true);
    }
  };
}
