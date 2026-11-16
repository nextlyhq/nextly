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
    "about 3.4 s against 100 ms: every selection works out the allowed actions by trying each on a copy of the whole page",
  "select-outline":
    "about 3.4 s against 100 ms: the outline moves in the same render as the sidebar, behind the same whole-page checks",
  "select-size-ratio":
    "about 19× against 2×: selection cost grows with the page's size (about 180 ms on 4 blocks, 3.4 s on 150)",
  "select-requests":
    "one request against none: each selection asks the server for the list collections again",
  "quick-clicks-blocking":
    "about 10 s against 400 ms: four quick clicks are handled one after another, each behind the whole-page checks",
  "add-panel-open":
    "about 2.3 s against 200 ms: opening the Add panel tries an insert to decide its blocks",
  "add-panel-insert":
    "about 4 s against 300 ms: an insert repeats the whole-page checks and redraws the page and its header and footer",
  undo: "about 2.4 s against 200 ms: undo repeats the whole-page checks",
  "keystroke-canvas":
    "not shown until the field is left, against 100 ms: the canvas does not follow typing yet",
  "leave-field-canvas":
    "about 0.8 s against 200 ms: leaving the field commits the edit behind the whole-page checks",
  "label-drag-release":
    "about 0.7 s against 200 ms: the release commits the value behind the whole-page checks",
  "insert-hides-regions":
    "about 12 against none: an insert redraws the header and footer, and their pictures blink",
  "footer-resizes":
    "at least one against none: the footer changes size when the pointer rests on its top edge",
  "publish-request":
    "about 1.8 s against 300 ms: the page is checked several times in the browser before the save is sent",
  "publish-saved":
    "about 5.4 s against 1.5 s: the save is checked again and read back before the editor settles",
  "idle-commits":
    "one against none: an untouched editor still renders on the lock renewal's timer",
};
