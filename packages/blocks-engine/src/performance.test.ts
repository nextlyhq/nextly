import { describe, expect, it } from "vitest";

import { migrateDocument } from "./migration";
import type { MigrationSource } from "./migration";
import {
  SCALE_BREAKPOINTS,
  fiveThousandNodePage,
  scaleDocument,
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
 * quadruples it for quadratic work, so the RATIO separates them, and a ratio is
 * independent of how fast the machine is. Absolute budgets still exist for
 * humans, reported by the benchmark suite in `performance.bench.ts`.
 *
 * Measurements take the fastest of several runs. Noise can only ever add time,
 * so the minimum is the closest estimate of the real cost.
 */

/**
 * Fastest wall-clock time, in milliseconds, of `runs` rounds that each execute
 * the operation `ITERATIONS_PER_ROUND` times.
 *
 * The repetition is what makes the number trustworthy: one pass over a thousand
 * nodes takes a couple of milliseconds, close enough to timer granularity that
 * scheduler noise shows up as a large percentage. Repeating inside the timed
 * region moves the measurement into tens of milliseconds without changing the
 * ratio being asserted.
 */
const ITERATIONS_PER_ROUND = 10;

/** Wall-clock time of one round: `ITERATIONS_PER_ROUND` passes of the operation. */
function timeRound(operation: () => void): number {
  const started = performance.now();
  for (let pass = 0; pass < ITERATIONS_PER_ROUND; pass += 1) operation();
  return performance.now() - started;
}

function fastest(runs: number, operation: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < runs; run += 1) {
    best = Math.min(best, timeRound(operation));
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
  let bestFirst = Number.POSITIVE_INFINITY;
  let bestSecond = Number.POSITIVE_INFINITY;
  for (let run = 0; run < runs; run += 1) {
    bestFirst = Math.min(bestFirst, timeRound(first));
    bestSecond = Math.min(bestSecond, timeRound(second));
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
 * Where to sit between them was measured rather than reasoned, because a
 * quadratic in part of the work moves the ratio by less than a quadratic in all
 * of it. Over repeated runs: unchanged code 4.05x–4.16x, a quadratic confined
 * to the id-tracking step 6.96x–7.08x, and one dominating the traversal 10.16x.
 * A limit of 6 sits in the gap, far enough above the linear band that noise
 * would have to inflate one side by half, and below a regression that accounts
 * for only a fraction of the total. Interleaving the two measurements is what
 * keeps the linear band that tight, so the two belong together.
 */
const MAX_GROWTH_FACTOR = 6;

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
      const perRound = fastest(
        3,
        () =>
          void validate(doc, { breakpoints: SCALE_BREAKPOINTS, mode: "strict" })
      );
      expect(perRound / ITERATIONS_PER_ROUND).toBeLessThan(
        CATASTROPHE_CEILING_MS
      );
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
  /**
   * Every generated block type is at version 2 with a step from 1, so each of
   * the thousand nodes has real migration work rather than short-circuiting on
   * an already-current version.
   */
  /**
   * One shared definition, as a real registry returns. Building a fresh object and
   * closure per node would put thousands of allocations inside the measured region
   * that migration itself never performs.
   */
  const SCALE_BLOCK_INFO = {
    version: 2,
    migrate: { 1: (props: Record<string, unknown>) => props },
  };

  const source: MigrationSource = {
    get: type => (type.startsWith("core/") ? SCALE_BLOCK_INFO : undefined),
  };

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
    expect(order.filter(side => side === "small")).toHaveLength(
      3 * ITERATIONS_PER_ROUND
    );
    expect(order.filter(side => side === "large")).toHaveLength(
      3 * ITERATIONS_PER_ROUND
    );
  });
});
