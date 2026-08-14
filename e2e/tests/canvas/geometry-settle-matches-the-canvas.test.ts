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
 * The comma-separated entries of a `transition` shorthand, splitting only at TOP LEVEL.
 *
 * A timing function carries its own commas — `cubic-bezier(.1,.7,1,.1)` has three — so an
 * unconditional split tears one entry into pieces and separates a delay from the duration it
 * belongs to. The two then pass an allowance check independently while the transition they
 * describe runs for their sum.
 */
function topLevelEntries(declaration: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of declaration) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      entries.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  entries.push(current);
  return entries;
}

/**
 * How long each `transition` entry can still be moving geometry, in milliseconds.
 *
 * Duration PLUS delay, and the delay is SIGNED. A negative delay is valid CSS and means the
 * transition starts partway through, so it finishes EARLIER: `height .1s ease -.05s` ends 50ms
 * after the style change, not 150ms. Reading the magnitude would reject a transition the
 * allowance already covers — a false failure, which is the direction that gets a guard disabled.
 *
 * A `transition` shorthand takes at most two times, and the FIRST is the duration and the second
 * the delay, whatever order the other keywords appear in. Anything past the second is a keyword,
 * so summing every number in the entry would inflate the total instead.
 */
export function zoneTransitionSpansMs(source: string): number[] {
  const spans: number[] = [];
  for (const line of source.split("\n")) {
    if (!line.includes("nx-pb-dropzone") || !line.includes("transition"))
      continue;
    const declaration = /transition\s*:\s*([^;"']+)/.exec(line);
    if (!declaration) continue;
    for (const entry of topLevelEntries(declaration[1])) {
      // The sign is part of the token. `[\d.]+` alone reads `-.05s` as `.05s`, which is the
      // magnitude of a value whose whole meaning is its direction.
      const times = [...entry.matchAll(/(-?[\d.]+)(ms|s)\b/g)].map(
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

/**
 * The parser, exercised on inputs whose answer is known.
 *
 * Reading it off the real stylesheet cannot cover these: the shapes that broke it are ones the
 * canvas does not currently use, and a guard is worth having precisely for the day it does. This
 * parser has now been wrong in four distinct ways — a hardcoded allowance, an unsummed delay,
 * commas inside a timing function, and an unsigned delay — so the controls exercise the SHAPES
 * rather than the current CSS.
 */
test("the span parser reads each transition shape correctly", () => {
  const spans = (css: string) =>
    zoneTransitionSpansMs(`  ".nx-pb-dropzone{transition:${css}}",`);

  // Duration alone.
  expect(spans("height .1s ease")).toEqual([100]);

  // Duration plus delay: the sum is what the allowance must cover.
  expect(spans("height .1s ease .05s")).toEqual([150]);

  // A timing function's own commas are NOT entry separators. Split naively this reports two
  // spans of 100 and 50, each of which clears a 120ms allowance while the transition runs 150ms.
  expect(spans("height .1s cubic-bezier(.1,.7,1,.1) .05s")).toEqual([150]);

  // A NEGATIVE delay starts the transition partway through, so it ends EARLIER. Read as a
  // magnitude this is 150 and would reject a transition the allowance already covers.
  expect(spans("height .1s ease -.05s")).toEqual([50]);

  // Several properties, each its own entry with its own timings.
  expect(spans("height .1s ease .05s,background .2s ease")).toEqual([150, 200]);

  // Milliseconds as well as seconds.
  expect(spans("height 120ms ease 30ms")).toEqual([150]);
});
