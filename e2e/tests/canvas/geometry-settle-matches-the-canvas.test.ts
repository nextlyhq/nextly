/**
 * The drop-zone timing the probe's settle allowance was chosen against.
 *
 * `poc-driver` declares `geometrySettleMs` — how long the canvas may still be moving a zone edge
 * after the pointer enters it — and the canvas animates that geometry in its own stylesheet. Two
 * statements of one fact, and nothing in either file refers to the other.
 *
 * ## Why this PINS the declaration instead of reading it
 *
 * The first version parsed the `transition` shorthand out of `IframeCanvas.tsx` and compared the
 * computed span against the allowance. That reader was wrong FOURTEEN times, and the list is worth
 * keeping because it is the argument: a hardcoded copy of the value it was checking; every time
 * token read separately so a delay was never summed; commas inside `cubic-bezier()` treated as
 * entry separators; an unsigned delay read as its magnitude; a unit-bearing identifier
 * (`var(--ease-50ms)`) mined for a duration; a second declaration on one line never seen;
 * `calc(.04s + .03s)` summed as separate numbers; a colour's timing charged to the geometry
 * budget; a property-last shorthand (`.2s ease margin`) misread; an implicit-`all` shorthand
 * skipped; a non-exhaustive geometry allowlist silently dropping `max-height` and `block-size`;
 * longhand `transition-duration` overrides ignored; and a leading `+` rejected.
 *
 * Each fix was correct and each earned the next finding, because a regex over CSS source does not
 * DETERMINE the answer being asked of it — `.claude/rules/derived-checks.md` calls that an
 * abstraction mismatch, where patching by example has no end.
 *
 * So this makes no semantic claim about CSS. It asserts the declaration is UNCHANGED. That is
 * complete by construction: every one of the fourteen cases changes the text, so every one trips
 * it, and none requires the test to understand what it changed to. The cost is that a cosmetic
 * edit also trips it — which is the right direction, because the person editing that line is
 * exactly the person who should re-check the allowance.
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
 * Regenerate by running the selector below against the file; do not hand-edit to make a failure
 * go away, because the failure IS the notification that the geometry timing moved.
 */
const PINNED = [
  '".nx-pb-dropzone{height:0;border-radius:3px;transition:height .1s ease,background .1s ease}",',
];

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

  // The positive control, and it is not decoration: a selector that matched nothing would satisfy
  // an equality against an empty PINNED and certify a file it never read.
  expect(found.length).toBeGreaterThan(0);

  expect(
    found,
    `the canvas drop-zone transition changed. Re-derive how long geometry can still be moving and ` +
      `update POC_GEOMETRY_SETTLE_MS in poc-driver.ts (currently ${String(POC_GEOMETRY_SETTLE_MS)}ms), ` +
      `then update PINNED here. This test deliberately does not parse CSS: doing so was wrong ` +
      `fourteen times, so it reports that the timing moved rather than guessing by how much.`
  ).toEqual(PINNED);
});
