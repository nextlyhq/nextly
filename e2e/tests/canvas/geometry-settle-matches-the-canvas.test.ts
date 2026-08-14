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

/** Every `transition` duration the drop-zone rules declare, in milliseconds. */
function zoneTransitionDurationsMs(source: string): number[] {
  const found: number[] = [];
  for (const rule of source.split("\n")) {
    if (!rule.includes("nx-pb-dropzone") || !rule.includes("transition"))
      continue;
    for (const [, value, unit] of rule.matchAll(/([\d.]+)(ms|s)\b/g)) {
      found.push(unit === "s" ? Number(value) * 1000 : Number(value));
    }
  }
  return found;
}

test("the PoC driver's settle allowance covers the zone transition it animates", () => {
  const source = readFileSync(CANVAS_CSS, "utf8");
  const durations = zoneTransitionDurationsMs(source);

  // The positive control, and it is the whole reason this file is not vacuous: a parser that
  // matched nothing would satisfy every assertion below by having no values to check.
  expect(durations.length).toBeGreaterThan(0);

  // Imported rather than restated, so this cannot pass against a number the driver does not
  // actually use — a guard holding its own copy compares a constant with itself.
  const declared = POC_GEOMETRY_SETTLE_MS;
  for (const duration of durations) {
    expect(
      duration,
      `a drop-zone transition of ${String(duration)}ms is not covered by the driver's ${String(declared)}ms geometrySettleMs — raise geometrySettleMs in poc-driver.ts`
    ).toBeLessThanOrEqual(declared);
  }
});
