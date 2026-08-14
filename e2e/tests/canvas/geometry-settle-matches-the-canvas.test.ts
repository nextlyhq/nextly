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
 * Properties whose transition moves a zone EDGE.
 *
 * A `background` transition changes nothing the probe measures, so its timing must not be charged
 * to the settle allowance — the stylesheet already carries one, and a visual timing change would
 * otherwise either fail CI or make every geometry probe wait for a colour.
 */
const GEOMETRY_PROPERTIES = [
  "height",
  "width",
  "margin",
  "padding",
  "inset",
  "top",
  "bottom",
  "transform",
  "all",
];

/** Syntax this reader cannot evaluate, and must not guess at. */
const UNREPRESENTABLE = /\bcalc\(|\bvar\(|\bclamp\(|\bmin\(|\bmax\(/;

/**
 * The comma-separated entries of a `transition` shorthand, splitting only at TOP LEVEL.
 *
 * A timing function carries its own commas — `cubic-bezier(.1,.7,1,.1)` has three — so an
 * unconditional split tears one entry into pieces and separates a delay from the duration it
 * belongs to.
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

/** What this reader could not judge, so a caller can refuse rather than under-report. */
export interface TransitionScan {
  /** Geometry spans it DID evaluate, in milliseconds. */
  readonly spansMs: number[];
  /** Declarations it declined to evaluate, verbatim. */
  readonly unreadable: string[];
}

/**
 * Every geometry `transition` on the drop-zone rules, and everything this reader refused.
 *
 * **It reports what it cannot represent instead of guessing.** That is the whole design, and it
 * is a correction: this reader has been wrong nine times, and every one was a silent WRONG NUMBER
 * rather than a refusal — a hardcoded allowance, an unsummed delay, commas inside a timing
 * function, an unsigned delay, a unit-bearing identifier read as a time, a second declaration on
 * one line never seen, `calc()` summed as separate numbers, and a colour's timing charged to the
 * geometry budget. A regex cannot represent CSS, so the honest move is not another case: it is to
 * say so when the input leaves what it can represent.
 *
 * Refusing is safe HERE specifically because a refusal fails the test. The caller turns anything
 * in `unreadable` into a failure naming the declaration, so an unjudgeable transition stops CI
 * rather than passing quietly — the opposite of the direction every previous defect failed in.
 *
 * The end state is to delete this entirely: if the canvas derived its transition from an exported
 * constant, the driver would import that constant and there would be nothing to parse. Filed as
 * `tasks/left-tasks/2026-08-14-2200-delete-the-transition-parser.md`.
 */
export function scanZoneTransitions(source: string): TransitionScan {
  const spansMs: number[] = [];
  const unreadable: string[] = [];
  for (const line of source.split("\n")) {
    if (!line.includes("nx-pb-dropzone")) continue;
    // EVERY declaration on the line, not the first. CSS applies the last of a duplicate pair, so
    // stopping at one records a value the browser does not use.
    for (const [, body] of line.matchAll(/transition\s*:\s*([^;"']+)/g)) {
      for (const entry of topLevelEntries(body)) {
        if (UNREPRESENTABLE.test(entry)) {
          unreadable.push(entry.trim());
          continue;
        }
        const property = entry.trim().split(/\s+/)[0];
        if (!GEOMETRY_PROPERTIES.includes(property)) continue;
        // Times only where a NUMBER precedes the unit, so `var(--ease-50ms)` — already refused
        // above — and any identifier carrying a unit cannot be read as a duration.
        const times = [...entry.matchAll(/(?:^|\s)(-?[\d.]+)(ms|s)\b/g)].map(
          ([, value, unit]) =>
            unit === "s" ? Number(value) * 1000 : Number(value)
        );
        if (times.length === 0) continue;
        spansMs.push(times[0] + (times[1] ?? 0));
      }
    }
  }
  return { spansMs, unreadable };
}

test("the PoC driver's settle allowance covers the zone geometry it animates", () => {
  const source = readFileSync(CANVAS_CSS, "utf8");
  const { spansMs, unreadable } = scanZoneTransitions(source);

  // Refusals are FAILURES, not skips. An unjudgeable declaration is exactly when this guard has
  // nothing to say, and saying nothing is how the previous nine defects passed.
  expect(
    unreadable,
    `this reader cannot evaluate ${unreadable.join(" | ")} — compute the span another way or delete the parser (see tasks/left-tasks/2026-08-14-2200-delete-the-transition-parser.md)`
  ).toEqual([]);

  // The positive control, and the whole reason this file is not vacuous: a reader that matched
  // nothing would satisfy the comparison below by having nothing to compare.
  expect(spansMs.length).toBeGreaterThan(0);

  for (const span of spansMs) {
    expect(
      span,
      `a drop-zone geometry transition lasting ${String(span)}ms is not covered by the driver's ${String(POC_GEOMETRY_SETTLE_MS)}ms geometrySettleMs — raise geometrySettleMs in poc-driver.ts`
    ).toBeLessThanOrEqual(POC_GEOMETRY_SETTLE_MS);
  }
});

test("the reader judges what it can and refuses what it cannot", () => {
  const scan = (css: string) =>
    scanZoneTransitions(`  ".nx-pb-dropzone{transition:${css}}",`);

  // Duration alone, and duration plus delay.
  expect(scan("height .1s ease").spansMs).toEqual([100]);
  expect(scan("height .1s ease .05s").spansMs).toEqual([150]);

  // A timing function's own commas are not entry separators.
  expect(scan("height .1s cubic-bezier(.1,.7,1,.1) .05s").spansMs).toEqual([
    150,
  ]);

  // A NEGATIVE delay starts the transition partway through, so it ends EARLIER.
  expect(scan("height .1s ease -.05s").spansMs).toEqual([50]);

  // A non-geometry property moves no edge, so its timing is not the probe's concern.
  expect(scan("height .1s ease, background .1s ease .2s").spansMs).toEqual([
    100,
  ]);

  // A unit-bearing IDENTIFIER is not a time. This one is refused outright as a `var()`, which is
  // the honest answer — the reader cannot know what the variable resolves to.
  expect(scan("height .1s var(--ease-50ms)").unreadable).toHaveLength(1);
  expect(scan("height .1s var(--ease-50ms)").spansMs).toEqual([]);

  // A computed time is refused rather than summed wrongly.
  expect(scan("height .06s ease calc(.04s + .03s)").unreadable).toHaveLength(1);

  // Milliseconds, and BOTH declarations when a line carries two — CSS applies the later one, so
  // recording only the first hides the value the browser actually uses.
  expect(scan("height 120ms ease 30ms").spansMs).toEqual([150]);
  expect(
    scanZoneTransitions(
      `  ".nx-pb-dropzone{transition:height .1s;transition:height .15s}",`
    ).spansMs
  ).toEqual([100, 150]);
});
