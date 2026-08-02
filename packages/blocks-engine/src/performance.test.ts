import { describe, expect, it } from "vitest";

import { migrateDocument } from "./migration";
import {
  SCALE_BREAKPOINTS,
  fiveThousandNodePage,
  scaleDocument,
  staleMigrationSource,
  staleVersionPage,
  thousandNodePage,
} from "./scale.fixtures";
import { validate } from "./validation";

/**
 * The performance gate.
 *
 * It asserts how the engine SCALES, not how many milliseconds it takes. A
 * wall-clock threshold is the obvious design and the wrong one for a shared CI
 * runner: the same code passes on a quiet machine and fails on a noisy one, and
 * a gate that cries wolf gets muted, which leaves no gate at all.
 *
 * What actually matters is the regression that hurts — an accidental quadratic
 * in a traversal. Doubling the input doubles the time for linear work and
 * quadruples it for quadratic work, so the RATIO separates them where an
 * absolute time does not. Absolute budgets still exist for humans, reported by
 * the benchmark suite in `performance.bench.ts`.
 *
 * A ratio is far steadier across machines than a duration, but it is NOT
 * independent of them. Linear work measures 4.05x–4.16x on a quiet developer
 * machine, against a theoretical 4.0, and 6.36x–6.77x on a shared CI runner:
 * the larger document is four times the memory, and collection cost does not
 * grow linearly with it. The threshold has to clear the noisier environment,
 * which is what bounds how tight it can be.
 *
 * Measurements take the fastest of several runs. Noise can only ever add time,
 * so the minimum is the closest estimate of the real cost.
 */

/**
 * How long one measured round should take.
 *
 * The repetition is what makes a number trustworthy: a single pass can be close
 * enough to the noise floor that scheduler and collector timing show up as a
 * large percentage. A FIXED pass count does not deliver that, because the
 * operations here differ by about seventy times in cost — ten passes of
 * validation take around 100 ms while ten passes of migration take 1.5 ms, and
 * at that size migration's ratio wandered between 4.25x and 4.79x locally and
 * past the limit on a CI runner, failing unchanged code.
 *
 * Choosing the count from a trial pass puts every operation in the same range
 * on whatever machine is running it. Measured at roughly this target, the
 * migration spread falls from 0.54 to 0.07 and lands on the same 4.1x the
 * validation walk reports.
 */
const TARGET_ROUND_MS = 25;

/** Bounds on the chosen count, so a mis-timed trial cannot run away. */
const MIN_PASSES = 10;
const MAX_PASSES = 2000;

/** How many passes of an operation add up to about one target round. */
function passesFor(operation: () => void): number {
  const started = performance.now();
  operation();
  const elapsed = performance.now() - started;
  if (elapsed <= 0) return MAX_PASSES;
  return Math.min(
    MAX_PASSES,
    Math.max(MIN_PASSES, Math.ceil(TARGET_ROUND_MS / elapsed))
  );
}

/** Wall-clock time of one round: `passes` executions of the operation. */
function timeRound(operation: () => void, passes: number): number {
  const started = performance.now();
  for (let pass = 0; pass < passes; pass += 1) operation();
  return performance.now() - started;
}

function fastest(runs: number, operation: () => void, passes: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < runs; run += 1) {
    best = Math.min(best, timeRound(operation, passes));
  }
  return best;
}

/**
 * Fastest round of each of two operations, measured in alternation.
 *
 * Timing one operation to completion and then the other lets a burst of load
 * land wholly on one side of a ratio. Another test file finishing during the
 * first measurement inflates it and the ratio comes out low; during the second
 * and it comes out high. Either way the number describes the machine rather
 * than the code, which is the one thing this gate is arranged not to do.
 * Alternating means a burst long enough to matter is seen by both sides, and
 * taking each side's minimum then discards it.
 */
function fastestPair(
  runs: number,
  first: () => void,
  second: () => void
): { first: number; second: number } {
  // One count for both sides, taken from the cheaper one: a ratio between
  // rounds of different lengths would measure the counts, not the code.
  const passes = passesFor(first);
  let bestFirst = Number.POSITIVE_INFINITY;
  let bestSecond = Number.POSITIVE_INFINITY;
  for (let run = 0; run < runs; run += 1) {
    bestFirst = Math.min(bestFirst, timeRound(first, passes));
    bestSecond = Math.min(bestSecond, timeRound(second, passes));
  }
  return { first: bestFirst, second: bestSecond };
}

/** The two document sizes compared. The spread is what gives the gate its power. */
const SMALL_NODES = 1000;
const LARGE_NODES = 4000;

/**
 * How much slower the four-times-larger input may be.
 *
 * The spread matters more than the threshold. At twice the size, linear work
 * costs 2x and quadratic work 4x, and a measured quadratic landed at 2.93x
 * against a 3x limit: near enough to slip through. Four times the size
 * separates the two shapes properly, at 4x against 16x.
 *
 * Where to sit between them is bounded from BELOW by the noisiest environment
 * the gate runs in, not by the cleanest. Measured over repeated runs:
 *
 * | shape                            | developer machine | CI runner |
 * | unchanged code                   | 4.03x–4.18x       | 6.36x–6.77x |
 * | quadratic in the id-tracking step| 5.81x             | — |
 *
 * The CI band is what makes anything under 8 unusable: a limit of 6 sits below
 * where unchanged code already lands there, so it fails clean work, and a gate
 * that cries wolf gets muted.
 *
 * What that costs is worth stating rather than discovering later. A ratio is
 * diluted by however much linear work surrounds the regression, so the same
 * injected quadratic measured 9.24x against the bare tree walk and 5.81x once
 * the per-node style walk was added — under the 8 the CI band forces. This gate
 * therefore catches a regression that DOMINATES an operation, not one that
 * merely doubles it, and the closer an operation gets to its own noise the
 * truer that becomes. The absolute numbers in the benchmark report are what
 * show a doubling.
 *
 * The developer band above is what it is BECAUSE the pass count is chosen per
 * operation. With a fixed count the migration walk measured 4.25x–4.79x here
 * and 8.64x on a runner, which failed unchanged code: its round was a tenth the
 * length of the validation walk's and correspondingly noisier, not slower.
 */
const MAX_GROWTH_FACTOR = 8;

/**
 * A ceiling that no working implementation approaches, present only to catch a
 * change that makes the engine unusable rather than merely slower. Deliberately
 * far above the informative budget so runner speed cannot trip it.
 */
const CATASTROPHE_CEILING_MS = 2000;

/**
 * Time allowed for one measurement test.
 *
 * A measurement runs the operation many times on purpose, so it is slow by
 * design: around 1.6 s locally. Vitest's default 5 s would then fail on a
 * worker three times slower than a laptop — reintroducing the runner-dependent
 * failure this whole file is arranged to avoid. The budget is generous because
 * it is not the thing being asserted.
 */
const MEASUREMENT_TIMEOUT_MS = 120_000;

describe("validation scales linearly with document size", () => {
  it(
    "does not slow super-linearly when the document grows four times",
    () => {
      const ctx = { breakpoints: SCALE_BREAKPOINTS, mode: "strict" as const };
      const small = scaleDocument({ nodes: SMALL_NODES });
      const large = scaleDocument({ nodes: LARGE_NODES });
      // Warm up so the first measurement is not paying for lazy compilation.
      validate(small, ctx);
      validate(large, ctx);

      const { first: smallTime, second: largeTime } = fastestPair(
        5,
        () => void validate(small, ctx),
        () => void validate(large, ctx)
      );
      const growth = largeTime / Math.max(smallTime, 0.001);

      expect(
        growth,
        `validating ${LARGE_NODES} nodes took ${growth.toFixed(2)}x the time of ${SMALL_NODES} (${smallTime.toFixed(1)}ms then ${largeTime.toFixed(1)}ms); linear work costs about 4x`
      ).toBeLessThan(MAX_GROWTH_FACTOR);
    },
    MEASUREMENT_TIMEOUT_MS
  );

  it(
    "stays far inside the ceiling on the thousand-node page",
    () => {
      const doc = thousandNodePage();
      const run = (): void =>
        void validate(doc, { breakpoints: SCALE_BREAKPOINTS, mode: "strict" });
      const passes = passesFor(run);
      const perRound = fastest(3, run, passes);
      expect(perRound / passes).toBeLessThan(CATASTROPHE_CEILING_MS);
    },
    MEASUREMENT_TIMEOUT_MS
  );

  it(
    "handles a document at the node ceiling",
    () => {
      const doc = fiveThousandNodePage();
      const issues = validate(doc, {
        breakpoints: SCALE_BREAKPOINTS,
        mode: "strict",
      });
      // At exactly the cap the document is legal, so the size itself is not an
      // issue; this asserts the engine completes rather than that it is silent.
      expect(
        issues.filter(issue => issue.code === "node-count-exceeded")
      ).toEqual([]);
    },
    MEASUREMENT_TIMEOUT_MS
  );
});

describe("migration scales linearly with document size", () => {
  // Every generated block type is one version ahead of the document, so each
  // node has real migration work rather than short-circuiting.
  const source = staleMigrationSource();

  it("actually migrates, so the measurement below is of real work", () => {
    // A source that resolves nothing still makes migration walk the tree, so
    // the scaling assertion alone would stay green if the step stopped running.
    const doc = staleVersionPage(10, 1);
    expect(doc.nodes[0]?.version).toBe(1);
    const migrated = migrateDocument(doc, source);
    expect(migrated.failures).toEqual([]);
    expect(migrated.doc.nodes[0]?.version).toBe(2);
  });

  it(
    "does not slow super-linearly when the document grows four times",
    () => {
      const small = staleVersionPage(SMALL_NODES, 1);
      const large = staleVersionPage(LARGE_NODES, 1);
      migrateDocument(small, source);
      migrateDocument(large, source);

      const { first: smallTime, second: largeTime } = fastestPair(
        5,
        () => void migrateDocument(small, source),
        () => void migrateDocument(large, source)
      );
      const growth = largeTime / Math.max(smallTime, 0.001);

      expect(
        growth,
        `migrating ${LARGE_NODES} nodes took ${growth.toFixed(2)}x the time of ${SMALL_NODES} (${smallTime.toFixed(1)}ms then ${largeTime.toFixed(1)}ms); linear work costs about 4x`
      ).toBeLessThan(MAX_GROWTH_FACTOR);
    },
    MEASUREMENT_TIMEOUT_MS
  );
});

describe("the two sides of a ratio are measured together", () => {
  it("alternates the operations instead of timing one to completion", () => {
    // Sequential timing puts every pass of one side before the first pass of
    // the other, which is exactly what lets a burst of load skew one of them.
    // Interleaving is the property being asserted, so it is asserted directly
    // rather than inferred from a timing that would be noise-dependent.
    const order: string[] = [];
    fastestPair(
      3,
      () => order.push("small"),
      () => order.push("large")
    );
    expect(order.indexOf("large")).toBeLessThan(order.lastIndexOf("small"));
    // Both sides get the same number of MEASURED passes, whatever count was
    // chosen; the one extra on the first side is the trial that chose it.
    const smalls = order.filter(side => side === "small").length;
    const larges = order.filter(side => side === "large").length;
    expect(smalls - 1).toBe(larges);
    expect(larges).toBeGreaterThanOrEqual(3 * MIN_PASSES);
  });
});
