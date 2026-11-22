/**
 * The builder's speed budgets: what an author on a slow machine may wait for,
 * measured by `measure.mjs` on a production build with the processor slowed
 * 4×, and judged by `report.mjs`.
 *
 * Each budget is a ceiling: a result above it is a miss. `unit` says how the
 * result reads ("ms", "requests", "×", "%"...), and `aggregate` how one result
 * is made from the samples:
 *
 * - `p75`: the 75th percentile, for timings (each from 10 samples unless the
 *   measure says otherwise), and for counts that depend on timing;
 * - `max`: the most any sample saw, for a count whose budget is none, so one
 *   occurrence is enough to miss it;
 * - `single`: one reading, for a measure taken once (an idle minute, a ratio
 *   of two results, a heap reading).
 *
 * The budgets are the product's targets, not tuned to today's results.
 * Changing one changes what the builder promises: do it only on purpose, in a
 * pull request that says why. Today's misses are listed in
 * `expected-failures.mjs`, one line each, so each fix removes its own line.
 *
 * Plain JavaScript, so the script and its unit test load it on any Node
 * version `engines` allows.
 *
 * @module builder-speed/budgets
 */

/**
 * @typedef {object} Budget
 * @property {string} id stable key, used in the results file and the marks
 * @property {string} label what is measured, as a person reads it
 * @property {number} budget the most the result may be
 * @property {string} unit how the result reads
 * @property {"p75" | "max" | "single"} aggregate how samples become one result
 */

/** @type {readonly Budget[]} */
export const BUDGETS = [
  {
    id: "select-sidebar",
    label: "Click a block: the sidebar shows it",
    budget: 100,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "select-outline",
    label: "Click a block: the selection outline moves to it",
    budget: 100,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "select-size-ratio",
    label: "Selecting on the 150-block page against the 4-block page",
    budget: 2,
    unit: "×",
    aggregate: "single",
  },
  {
    id: "select-requests",
    label: "Server requests per selection",
    budget: 0,
    unit: "requests",
    aggregate: "max",
  },
  {
    id: "quick-clicks-blocking",
    label: "Four quick clicks: main-thread blocking in all",
    budget: 400,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "add-panel-open",
    label: "Open the Add panel",
    budget: 200,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "add-panel-insert",
    label: "Insert a block from the Add panel",
    budget: 300,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "undo",
    label: "Undo",
    budget: 200,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "keystroke-canvas",
    label: "A keystroke in a sidebar text field: shown on the canvas",
    budget: 100,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "leave-field-canvas",
    label: "Leave a text field: the canvas shows the text",
    budget: 200,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "label-drag-release",
    label: "Release a label drag: the canvas shows the value",
    budget: 200,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "insert-hides-regions",
    label: "Header and footer elements hidden by an insert",
    budget: 0,
    unit: "elements",
    aggregate: "max",
  },
  {
    id: "footer-resizes",
    label:
      "Footer size changes while the pointer rests 10 px inside its top edge for 5 s",
    budget: 0,
    unit: "changes",
    aggregate: "single",
  },
  {
    id: "publish-request",
    label: "Publish: click to request sent",
    budget: 300,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "publish-saved",
    label: "Publish: click to the button showing it is saved",
    budget: 1500,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "open-canvas-slow-network",
    label: "Open the builder with 150 ms added per round trip: canvas drawn",
    budget: 2000,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "open-requests",
    label: "Open the builder: API requests before the canvas",
    budget: 15,
    unit: "requests",
    aggregate: "p75",
  },
  {
    id: "open-round-trips",
    label: "Open the builder: back-to-back round trips before the canvas",
    budget: 3,
    unit: "round trips",
    aggregate: "p75",
  },
  {
    id: "idle-requests",
    label:
      "An idle minute: requests (four lock renewals and one check for changes)",
    budget: 5,
    unit: "requests",
    aggregate: "single",
  },
  {
    id: "idle-commits",
    label: "An idle minute: React commits",
    budget: 0,
    unit: "commits",
    aggregate: "single",
  },
  {
    id: "heap-selections",
    label: "Heap growth from the 100th to the 200th selection",
    budget: 20,
    unit: "%",
    aggregate: "single",
  },
  {
    id: "heap-inserts",
    label: "Heap growth over 50 inserts",
    budget: 20,
    unit: "%",
    aggregate: "single",
  },
];
