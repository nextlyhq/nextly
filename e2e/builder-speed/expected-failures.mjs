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
  "select-sidebar":
    "about 330 ms against 100 ms on the 150-block page: a selection still renders the editor and its page around it",
  "select-outline":
    "about 330 ms against 100 ms: the outline moves in the same render as the sidebar",
  "quick-clicks-blocking":
    "about 1.2 s against 400 ms: four quick clicks are handled one after another, each a long task",
  "add-panel-insert":
    "about 470 ms against 300 ms: an insert redraws the page and its header and footer",
  "keystroke-canvas":
    "not shown until the field is left, against 100 ms: the canvas does not follow typing yet",
  "open-canvas-slow-network":
    "about 2.1 s against 2.0 s at 150 ms a round trip: the canvas waits on a chain of requests",
  "open-requests":
    "18 against 15: besides the admin's own reads as it loads, the component library and Layout choices are read on their own as the builder opens",
  "open-round-trips":
    "6 against 3: the requests before the canvas wait on each other",
};
