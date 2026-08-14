/**
 * The probe's settle allowance must still cover what the canvas actually animates.
 *
 * `geometrySettleMs` is a number the driver states and the canvas owns, and nothing in either file
 * refers to the other — the exact shape `.claude/rules/derived-checks.md` calls out, where two
 * copies agree on the day they are written and drift silently afterwards. The drift is invisible in
 * the direction that matters: lengthen the CSS transition and every inset measurement quietly
 * starts coming back stale, with no test naming the timing.
 *
 * Deriving the driver's value from the stylesheet at runtime is not available — the rule lives in a
 * template string compiled into the iframe, and a zone only exists mid-drag. So the duplication
 * stays and is CHECKED instead, which is the weaker remedy the rule permits when one answer cannot
 * be shared.
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
 * How long each `transition` entry can still be moving geometry, in milliseconds.
 *
 * Duration PLUS delay, per entry, because the shorthand carries both and the settle allowance has
 * to cover the moment the last one stops. `height .1s ease .05s` is 150ms of possible movement;
 * reading the two numbers separately reports 100 and 50, and each passes a 120ms allowance while
 * the edge keeps travelling past it — the guard green for the same reason the probe is wrong.
 *
 * A `transition` shorthand takes at most two times, and the FIRST is the duration and the second
 * the delay, whatever order the other keywords appear in. Anything past the second is a keyword,
 * so summing every number in the entry would inflate the total instead.
 */
function zoneTransitionSpansMs(source: string): number[] {
  const spans: number[] = [];
  for (const line of source.split("\n")) {
    if (!line.includes("nx-pb-dropzone") || !line.includes("transition"))
      continue;
    const declaration = /transition\s*:\s*([^;"']+)/.exec(line);
    if (!declaration) continue;
    // Comma-separated entries, each its own property with its own timings.
    for (const entry of declaration[1].split(",")) {
      const times = [...entry.matchAll(/([\d.]+)(ms|s)\b/g)].map(
        ([, value, unit]) =>
          unit === "s" ? Number(value) * 1000 : Number(value)
      );
      if (times.length === 0) continue;
      spans.push(times[0] + (times[1] ?? 0));
    }
  }
  return spans;
}

test("the PoC driver's settle allowance covers the zone transition it animates", () => {
  const source = readFileSync(CANVAS_CSS, "utf8");
  const durations = zoneTransitionSpansMs(source);

  // The positive control, and it is the whole reason this file is not vacuous: a parser that
  // matched nothing would satisfy every assertion below by having no values to check.
  expect(durations.length).toBeGreaterThan(0);

  // Imported rather than restated, so this cannot pass against a number the driver does not
  // actually use — a guard holding its own copy compares a constant with itself.
  const declared = POC_GEOMETRY_SETTLE_MS;
  for (const duration of durations) {
    expect(
      duration,
      `a drop-zone transition lasting ${String(duration)}ms is not covered by the driver's ${String(declared)}ms geometrySettleMs — raise geometrySettleMs in poc-driver.ts`
    ).toBeLessThanOrEqual(declared);
  }
});
