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
 * The drop-zone geometry, as ONE statement: the declaration exactly as the canvas writes it, and
 * how long the geometry in it keeps moving.
 *
 * Kept in a single structure so the two cannot be updated apart. They were separate constants, and
 * separate constants invite the half-edit: paste the new declaration, leave the number, and both
 * assertions below pass while the probe tolerates less than the canvas takes. Editing this literal
 * puts the span under the reader's cursor at the moment they change the text.
 *
 * `spanMs` is read off `declaration` by a person. It cannot go stale on its own — the only thing
 * that changes it is an edit to that text, which the first assertion refuses.
 */
const PINNED_GEOMETRY = {
  declaration:
    '".nx-pb-dropzone{height:0;border-radius:3px;transition:height .1s ease,background .1s ease}",',
  // `height` transitions over `.1s` with no delay. `background` moves no edge this probe measures.
  spanMs: 100,
} as const;

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
      "update PINNED_GEOMETRY here — both its declaration AND its spanMs, and raise POC_GEOMETRY_SETTLE_MS in " +
      "poc-driver.ts if the span now exceeds it."
  ).toEqual([PINNED_GEOMETRY.declaration]);
});

test("the driver's settle allowance covers that geometry", () => {
  // The other half. Pinning the text alone passes while someone lowers the allowance underneath
  // it, which lets the probe resume measuring an edge that is still travelling.
  expect(
    POC_GEOMETRY_SETTLE_MS,
    `geometrySettleMs is ${String(POC_GEOMETRY_SETTLE_MS)}ms and the drop-zone geometry moves for ` +
      `${String(PINNED_GEOMETRY.spanMs)}ms, so the probe can re-measure an edge that is still ` +
      "travelling. Raise it in poc-driver.ts."
  ).toBeGreaterThanOrEqual(PINNED_GEOMETRY.spanMs);
});
