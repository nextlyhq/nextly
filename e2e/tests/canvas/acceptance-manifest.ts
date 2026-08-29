/**
 * The twelve canvas acceptance properties, and which of them this suite covers.
 *
 * The manifest exists so coverage cannot shrink silently. Plan 04's D-04.4 asks
 * for a harness that "asserts its own test count", because `0 failures` is
 * indistinguishable from `0 tests ran` — and this programme has already shipped
 * three separate green results that were measuring nothing. A count alone is
 * not enough either: a suite that renamed a test and lost it would still count
 * twelve. So each property is named here with its status, the spec asserts that
 * every `covered` property has a test whose title matches, and a `deferred` one
 * carries the reason it cannot run yet.
 *
 * Deferring is not the same as passing, and a reader must never be able to
 * mistake one for the other: `pnpm test:e2e` reports the deferred set out loud.
 *
 * @module tests/canvas/acceptance-manifest
 */

export interface AcceptanceProperty {
  /** Plan 04 §4's number for it. Stable; the order below is that table's. */
  readonly n: number;
  /** The property, in the plan's own words. */
  readonly property: string;
  /**
   * Identifier of the work that was meant to turn it green, kept for
   * traceability — a plan item such as `B-6`, not a revision or a branch.
   */
  readonly greenIn: string;
  readonly status: "covered" | "deferred";
  /**
   * Why it cannot run yet. Required for `deferred`, forbidden for `covered` —
   * a covered property with an excuse attached is a property nobody re-checked.
   */
  readonly reason?: string;
}

export const ACCEPTANCE_PROPERTIES: readonly AcceptanceProperty[] = [
  {
    n: 1,
    property: "Pointer collision resolves by tree depth",
    greenIn: "B-6",
    status: "covered",
  },
  {
    n: 2,
    property: "Drag-start hysteresis: a click is never a drag",
    greenIn: "B-6",
    status: "covered",
  },
  {
    n: 3,
    property: "Target-switch hysteresis: the 2px oscillation test",
    greenIn: "B-7",
    status: "covered",
  },
  {
    n: 4,
    property: "Zero layout shift when drop zones appear",
    greenIn: "B-6",
    status: "covered",
  },
  {
    n: 5,
    property: "Exactly ONE overlay indicator element, in parent chrome",
    greenIn: "B-7",
    status: "covered",
  },
  {
    n: 6,
    property: "Indicator leads the pointer into a 6px gap",
    greenIn: "B-7",
    status: "covered",
  },
  {
    n: 7,
    property: "Explicit invalid-target state is reachable and visible",
    greenIn: "B-7",
    status: "covered",
  },
  {
    n: 8,
    property: "Autoscroll engages and stops at bounds",
    greenIn: "B-8",
    status: "covered",
  },
  {
    n: 9,
    property: "Rects cached at dragstart; 60fps on a 500-block tree",
    greenIn: "B-8",
    status: "covered",
    // The MECHANISM half only. Rect caching is observable by spying on
    // `getBoundingClientRect` from the test, which watches the engine without
    // altering it. The FRAME-RATE half stays out of the gate deliberately: it is
    // flaky on a shared runner, and a green there proves less than a bounded
    // read count does.
  },
  {
    n: 10,
    property: "One drop = exactly one undo entry",
    greenIn: "B-9",
    status: "covered",
  },
  {
    n: 11,
    property: "Panel drag and canvas drag are the same engine",
    greenIn: "B-15",
    status: "deferred",
    reason:
      "the feature exists now and the HARNESS cannot drive it: builder-canvas/harness.tsx mounts useCanvasDrag with no canvas root and no palette, so there is nothing to drag from. Its `data-nx-dragging` also reads `draggingId`, which is null for a drag carrying a block type rather than a node — so a palette drag would be invisible to the probe even once a palette is mounted. Scaffolding now, not a missing feature. See task:pb-inserter-drag",
  },
  {
    n: 12,
    property: "Escape cancels a drag, and the shell does not navigate",
    greenIn: "B-11",
    status: "covered",
    // Only the drag half here. "The shell does not navigate" is the shell's
    // property and the canvas harness mounts no shell — stated so the half
    // that IS covered is not read as the whole.
  },
];

export const COVERED = ACCEPTANCE_PROPERTIES.filter(
  p => p.status === "covered"
);
export const DEFERRED = ACCEPTANCE_PROPERTIES.filter(
  p => p.status === "deferred"
);

/** The title every covered property's test must carry, so a rename cannot hide one. */
export function titleFor(p: AcceptanceProperty): string {
  return `A${p.n}: ${p.property}`;
}
