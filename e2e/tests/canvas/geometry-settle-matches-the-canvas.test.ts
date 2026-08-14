/**
 * The drop-zone timing the probe's settle allowance is chosen against.
 *
 * `poc-driver` declares `geometrySettleMs` — how long the canvas may still be moving a zone edge
 * after the pointer enters it — while the canvas animates that geometry in its own stylesheet.
 * Two statements of one fact, in files that do not refer to each other, so this holds them
 * together.
 *
 * It asserts two things, and needs both:
 *
 * - the stylesheet declaration is UNCHANGED, so a timing edit cannot pass unnoticed;
 * - the driver's allowance still covers the span that declaration produces.
 *
 * Either alone is satisfiable while the pair is wrong. Pinning only the text passes when the
 * allowance is lowered underneath it; checking only the allowance passes when the transition is
 * lengthened.
 *
 * ## Why the declaration is PINNED rather than parsed
 *
 * Computing a span from CSS source means representing CSS: comma-separated entries whose commas
 * may belong to a timing function, times that may be signed or written as `calc()` or resolved
 * through a variable, properties that may appear last or be implicit, longhand declarations that
 * override the shorthand, and only some properties moving the edge this probe measures. A regex
 * cannot represent that, and each spelling handled reveals another.
 *
 * Pinning makes no semantic claim, which is what makes it complete: every one of those spellings
 * changes the text, so every one trips this, and none requires the test to understand what it
 * changed to. The cost is that a cosmetic edit trips it as well — which is the direction to want,
 * because whoever edits that line is who should re-derive the allowance.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { POC_GEOMETRY_SETTLE_MS } from "./poc-driver";

const CANVAS_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/plugin-page-builder/src/admin/canvas/IframeCanvas.tsx"
);

/**
 * The drop-zone rules carrying a `transition`, exactly as the canvas writes them.
 *
 * Do not hand-edit to clear a failure: the failure is the notification that the geometry timing
 * moved, and clearing it without re-deriving {@link PINNED_GEOMETRY_SPAN_MS} silently widens what
 * the probe tolerates.
 */
const PINNED = [
  '".nx-pb-dropzone{height:0;border-radius:3px;transition:height .1s ease,background .1s ease}",',
];

/**
 * How long the geometry above keeps moving, in milliseconds.
 *
 * Read off {@link PINNED} by a person rather than computed, and it travels with it: the only way
 * this value goes stale is an edit to that declaration, which the assertion below refuses. `height`
 * transitions over `.1s` with no delay; `background` moves no edge this probe measures.
 */
const PINNED_GEOMETRY_SPAN_MS = 100;

/** Every drop-zone line declaring a transition, trimmed, in file order. */
function transitionLines(source: string): string[] {
  return source
    .split("\n")
    .map(line => line.trim())
    .filter(
      line => line.includes("nx-pb-dropzone") && line.includes("transition")
    );
}

test("the drop-zone geometry timing has not changed under the probe", () => {
  const found = transitionLines(readFileSync(CANVAS_CSS, "utf8"));

  // A selector that matched nothing would satisfy an equality against an empty expectation and
  // certify a file it never read.
  expect(found.length).toBeGreaterThan(0);

  expect(
    found,
    "the canvas drop-zone transition changed. Re-derive how long its geometry keeps moving, " +
      "update PINNED_GEOMETRY_SPAN_MS and PINNED here, and raise POC_GEOMETRY_SETTLE_MS in " +
      "poc-driver.ts if the span now exceeds it."
  ).toEqual(PINNED);
});

test("the driver's settle allowance covers that geometry", () => {
  // The other half. Pinning the text alone passes while someone lowers the allowance underneath
  // it, which lets the probe resume measuring an edge that is still travelling.
  expect(
    POC_GEOMETRY_SETTLE_MS,
    `geometrySettleMs is ${String(POC_GEOMETRY_SETTLE_MS)}ms and the drop-zone geometry moves for ` +
      `${String(PINNED_GEOMETRY_SPAN_MS)}ms, so the probe can re-measure an edge that is still ` +
      "travelling. Raise it in poc-driver.ts."
  ).toBeGreaterThanOrEqual(PINNED_GEOMETRY_SPAN_MS);
});
