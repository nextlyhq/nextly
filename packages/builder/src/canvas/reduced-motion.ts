/**
 * Whether the reader asked the system for less motion.
 *
 * Asked of the window a canvas node or document belongs to, never the
 * editor's own: a frame's window answers for the frame, which is where the
 * canvas is drawn and where its media queries are read.
 *
 * @module reduced-motion
 */

/**
 * Whether the window `root` belongs to asks for reduced motion; `false` where
 * there is no window to ask.
 *
 * @param root - a canvas node, or the document of the frame it draws in
 */
export function prefersReducedMotion(root: Document | Element): boolean {
  const owner = "defaultView" in root ? root : root.ownerDocument;
  const view = owner.defaultView;
  if (view === null || typeof view.matchMedia !== "function") return false;
  return view.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
