/**
 * The budgets the builder misses today, each with how far off it is and why.
 * A listed miss does not fail the run; a listed one that passes does, so the
 * fix that makes it pass also removes its line here, and the gain is kept.
 *
 * One line per measure, so each fix removes only its own line and two fixes
 * landing together merge cleanly. Every measure here names a budget in
 * `budgets.mjs`; a line for one that does not exist fails the run.
 *
 * @module builder-speed/expected-failures
 */

/** @type {Readonly<Record<string, string>>} */
export const EXPECTED_FAILURES = {
  "select-sidebar": "about 330 ms against 100 ms on the 150-block page: a selection still renders the editor and its page around it",
  "select-outline": "about 330 ms against 100 ms: the outline moves in the same render as the sidebar",
  "select-size-ratio": "about 2.2x against 2x: a selection takes about 150 ms on the 4-block page and 330 ms on the 150-block page",
  "select-requests": "one request against none: each selection asks the server for the loop collections again",
  "quick-clicks-blocking": "about 1.2 s against 400 ms: four quick clicks are handled one after another, each a long task",
  "add-panel-insert": "about 470 ms against 300 ms: an insert redraws the page and its header and footer",
  "undo": "about 230 ms against 200 ms: undo redraws the page",
  "keystroke-canvas": "not shown until the field is left, against 100 ms: the canvas does not follow typing yet",
  "insert-hides-regions": "about 12 against none: an insert redraws the header and footer, and their pictures blink",
  "footer-resizes": "between 2 and 31 against none: the footer changes size while the pointer rests on its top edge",
  "open-canvas-slow-network": "about 2.0 s against 2.0 s at 150 ms a round trip: the canvas waits on a chain of requests",
  "open-requests": "25 against 15: the builder asks for its document, styles, library and media one request at a time",
  "open-round-trips": "7 against 3: the requests before the canvas wait on each other",
  "idle-commits": "one against none: an untouched editor still renders on a timer",
};
