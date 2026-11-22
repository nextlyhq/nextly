/**
 * When the sources the editor's canvas reads have changed: a save made in
 * this browser, or the change check finding one made elsewhere.
 *
 * What the canvas reads (its bindings' entry and Singles, its lists' rows) is
 * kept for as long as what it asks stays the same, with no lifetime of its
 * own: a lock renewal, an edit to an unrelated block or a minute's wait reads
 * nothing again. This is the one way a kept answer goes. The readers that
 * keep answers drop them here, and every mounted canvas then asks again for
 * what it draws.
 *
 * @module admin/canvas-sources
 */

/** Everything told when the sources change, in the order it was added. */
const LISTENERS = new Set<() => void>();

/**
 * Be told when the canvas's sources change. Readers that keep answers add
 * theirs when their module loads, before any canvas mounts, so a kept answer
 * is always dropped before a canvas asks again. Answers the way to stop.
 */
export function onCanvasSourcesChanged(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

/** The canvas's sources have changed: drop what was kept and ask again. */
export function canvasSourcesChanged(): void {
  for (const listener of [...LISTENERS]) listener();
}
