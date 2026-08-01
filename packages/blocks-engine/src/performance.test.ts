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

function fastest(runs: number, operation: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    for (let pass = 0; pass < ITERATIONS_PER_ROUND; pass += 1) operation();
    const elapsed = performance.now() - started;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

/** The two document sizes compared. The spread is what gives the gate its power. */
const SMALL_NODES = 1000;
const LARGE_NODES = 4000;

/**
 * How much slower the four-times-larger input may be.
 *
 * The spread matters more than the threshold. At twice the size, linear work
 * costs 2x and quadratic work 4x, and a measured quadratic landed at 2.93x
 * against a 3x limit: near enough to slip through. At four times the size the
 * same two shapes cost 4x and 16x, so 8 sits a clean factor of two from either,
 * and noise would have to double a measurement to matter.
 */
const MAX_GROWTH_FACTOR = 8;

/**
 * A ceiling that no working implementation approaches, present only to catch a
 * change that makes the engine unusable rather than merely slower. Deliberately
 * far above the informative budget so runner speed cannot trip it.
 */
const CATASTROPHE_CEILING_MS = 2000;

describe("validation scales linearly with document size", () => {
  it("does not slow super-linearly when the document grows four times", () => {
    const ctx = { breakpoints: SCALE_BREAKPOINTS, mode: "strict" as const };
    const small = scaleDocument({ nodes: SMALL_NODES });
    const large = scaleDocument({ nodes: LARGE_NODES });
    // Warm up so the first measurement is not paying for lazy compilation.
    validate(small, ctx);
    validate(large, ctx);

    const smallTime = fastest(5, () => void validate(small, ctx));
    const largeTime = fastest(5, () => void validate(large, ctx));
    const growth = largeTime / Math.max(smallTime, 0.001);

    expect(
      growth,
      `validating ${LARGE_NODES} nodes took ${growth.toFixed(2)}x the time of ${SMALL_NODES} (${smallTime.toFixed(1)}ms then ${largeTime.toFixed(1)}ms); linear work costs about 4x`
    ).toBeLessThan(MAX_GROWTH_FACTOR);
  });

  it("stays far inside the ceiling on the thousand-node page", () => {
    const doc = thousandNodePage();
    const perRound = fastest(
      3,
      () =>
        void validate(doc, { breakpoints: SCALE_BREAKPOINTS, mode: "strict" })
    );
    expect(perRound / ITERATIONS_PER_ROUND).toBeLessThan(
      CATASTROPHE_CEILING_MS
    );
  });

  it("handles a document at the node ceiling", () => {
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
  });
});

describe("migration scales linearly with document size", () => {
  /**
   * Every generated block type is at version 2 with a step from 1, so each of
   * the thousand nodes has real migration work rather than short-circuiting on
   * an already-current version.
   */
  const source: MigrationSource = {
    get: type =>
      type.startsWith("core/")
        ? {
            version: 2,
            migrate: { 1: (props: Record<string, unknown>) => props },
          }
        : undefined,
  };

  it("does not slow super-linearly when the document grows four times", () => {
    const small = staleVersionPage(SMALL_NODES, 1);
    const large = staleVersionPage(LARGE_NODES, 1);
    migrateDocument(small, source);
    migrateDocument(large, source);

    const smallTime = fastest(5, () => void migrateDocument(small, source));
    const largeTime = fastest(5, () => void migrateDocument(large, source));
    const growth = largeTime / Math.max(smallTime, 0.001);

    expect(
      growth,
      `migrating ${LARGE_NODES} nodes took ${growth.toFixed(2)}x the time of ${SMALL_NODES} (${smallTime.toFixed(1)}ms then ${largeTime.toFixed(1)}ms); linear work costs about 4x`
    ).toBeLessThan(MAX_GROWTH_FACTOR);
  });
});
