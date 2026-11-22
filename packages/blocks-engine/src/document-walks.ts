/**
 * How much measuring the engine has done, counted rather than timed.
 *
 * Two counters, both monotonic, read by taking a reading before and after the
 * work in question:
 *
 * - `walks`: whole-document safety walks, the full measurement that probes
 *   every object for a value the writer refuses. It runs where a document
 *   enters from outside (a save, an API write, an import), and an editor's own
 *   edits should cost none.
 * - `measuredObjects`: objects whose size was worked out afresh rather than
 *   read from the sizes already kept for them. An edit measures only the path
 *   from the changed node to the root, so this stays the same however large the
 *   rest of the document is.
 *
 * Counts rather than milliseconds because a count is the same on any machine
 * under any load, so a test can hold it exactly.
 *
 * What it does not count: the op layer's own pass over a document's nodes when
 * an edit is applied, which checks their shape rather than measuring them.
 *
 * @module document-walks
 */

let walks = 0;
let measuredObjects = 0;

/** One whole-document safety walk began. */
export function countDocumentWalk(): void {
  walks += 1;
}

/** One object's size was measured afresh. */
export function countMeasuredObject(): void {
  measuredObjects += 1;
}

/**
 * The engine's measuring work so far; compare two readings to cost a call.
 *
 * @experimental What is counted may change while the editor's speed work
 * settles; read it in tests and diagnostics, not to decide behaviour.
 */
export function documentWork(): { walks: number; measuredObjects: number } {
  return { walks, measuredObjects };
}
