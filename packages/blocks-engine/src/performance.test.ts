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
 * The scaling gate.
 *
 * It asserts how the engine SCALES, and it measures that in work done rather
 * than in time taken. The property worth defending is that no traversal becomes
 * quadratic in document size: doubling the input doubles linear work and
 * quadruples quadratic work, so a ratio between two sizes separates the shapes
 * where an absolute cost cannot.
 *
 * A wall clock is the obvious instrument for that ratio and the wrong one. It
 * measures the machine as much as the code — on a shared runner a neighbouring
 * job lands inside one side of the comparison — so the same unchanged code
 * reads differently from one run to the next, and a gate that fails clean work
 * gets discounted by everyone who sees it. Averaging, alternating and taking
 * minima all narrow that spread without closing it, because the noise is not a
 * property of the code and no amount of sampling makes it one.
 *
 * Counting instead is exact. The document handed to the engine reports every
 * property read taken from it, which is a direct census of the traversal: the
 * same document yields the same count on any machine, under any load. A linear
 * walk over four times the nodes performs four times the reads, and the two
 * operations here land within a thousandth of that.
 *
 * Absolute cost still matters to a human, and is still reported — by the
 * benchmark suite in `performance.bench.ts`, which is the right place for a
 * number that legitimately depends on the machine it ran on.
 */

/**
 * A document that tallies every property read the engine takes from it.
 *
 * Wrapped one level at a time so that nested nodes, props and style records are
 * each counted, which is what makes the tally track the traversal rather than
 * the shape of the top-level object. Only string keys count: the symbol reads
 * that drive iteration are an artefact of how a walk is written rather than of
 * how much of the document it visits.
 *
 * The proxy is transparent — every trap defers to `Reflect` — so the engine
 * computes exactly what it would have computed on the plain document. The tests
 * below pin that rather than trusting it, because an instrument that quietly
 * turned the walk into a shorter one would report a flattering ratio for the
 * same reason it reported a wrong result.
 */
function tallyingReads<T>(value: T, tally: { reads: number }): T {
  if (value === null || typeof value !== "object") return value;

  const count = {
    get(target: object, key: string | symbol, receiver: unknown): unknown {
      if (typeof key === "string") tally.reads += 1;
      return Reflect.get(target, key, receiver);
    },
  };

  if (Array.isArray(value)) {
    const items = value.map(item => tallyingReads(item, tally));
    return new Proxy(items, count) as T;
  }

  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    record[key] = tallyingReads(item, tally);
  }
  return new Proxy(record, count) as T;
}

/** How many property reads `operation` takes from `document`. */
function readsTaken<T>(document: T, operation: (document: T) => void): number {
  const tally = { reads: 0 };
  operation(tallyingReads(document, tally));
  return tally.reads;
}

/** The two document sizes compared. The spread is what gives the gate its power. */
const SMALL_NODES = 1000;
const LARGE_NODES = 4000;

/**
 * How much more work the four-times-larger document may cost.
 *
 * Linear work lands at 4.0 and quadratic work at 16.0, and because the count is
 * exact the limit can sit close to the honest answer instead of above the worst
 * reading a busy machine ever produced. Both operations here measure within a
 * thousandth of 4.0.
 *
 * The headroom above that is deliberate and bounded by one shape: a genuinely
 * `n log n` step — a sort introduced over the node list, say — costs
 * `4 x log(4000)/log(1000)`, about 4.8 at these sizes. That is legitimate work
 * and must not fail. Anything appreciably worse is not: `n^1.5` reaches 8 and
 * `n^2` reaches 16, so both are refused with room to spare.
 */
const MAX_GROWTH_FACTOR = 5;

/**
 * How long one measured round should take, for the absolute ceiling below.
 *
 * A single pass of a cheap operation can be close enough to the timer's
 * resolution that scheduling shows up as a large percentage of it. Choosing the
 * count from a trial pass puts whatever is being timed into a range where the
 * measurement means something.
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
 * A ceiling that no working implementation approaches, present only to catch a
 * change that makes the engine unusable rather than merely slower. This one is
 * a wall clock on purpose and can afford to be: it sits orders of magnitude
 * above where the engine runs, so no runner is slow enough to reach it.
 */
const CATASTROPHE_CEILING_MS = 2000;

/**
 * Time allowed for one measurement test.
 *
 * A measurement runs the operation many times on purpose, so it is slow by
 * design. Vitest's default 5 s would then fail on a worker several times slower
 * than a laptop, reintroducing the runner-dependent failure this file is
 * arranged to avoid. The budget is generous because it is not the thing being
 * asserted.
 */
const MEASUREMENT_TIMEOUT_MS = 120_000;

describe("validation scales linearly with document size", () => {
  const ctx = { breakpoints: SCALE_BREAKPOINTS, mode: "strict" as const };

  it("reports the same issues through the counting document", () => {
    // The precondition the ratio depends on. An instrument that shortened the
    // walk would report a flattering ratio, and would do it while the assertion
    // below still passed — so what the engine computed is compared directly.
    const doc = scaleDocument({ nodes: 50 });
    const tally = { reads: 0 };

    expect(validate(tallyingReads(doc, tally), ctx)).toEqual(
      validate(doc, ctx)
    );
    expect(tally.reads).toBeGreaterThan(0);
  });

  it("does not do super-linear work when the document grows four times", () => {
    const small = readsTaken(
      scaleDocument({ nodes: SMALL_NODES }),
      doc => void validate(doc, ctx)
    );
    const large = readsTaken(
      scaleDocument({ nodes: LARGE_NODES }),
      doc => void validate(doc, ctx)
    );
    const growth = large / small;

    expect(
      growth,
      `validating ${LARGE_NODES} nodes read ${growth.toFixed(3)}x as much of the document as ${SMALL_NODES} (${small} then ${large}); linear work reads about 4x`
    ).toBeLessThan(MAX_GROWTH_FACTOR);
  });

  it(
    "stays far inside the ceiling on the thousand-node page",
    () => {
      const doc = thousandNodePage();
      const run = (): void => void validate(doc, ctx);
      const passes = passesFor(run);
      const perRound = fastest(3, run, passes);
      expect(perRound / passes).toBeLessThan(CATASTROPHE_CEILING_MS);
    },
    MEASUREMENT_TIMEOUT_MS
  );

  it("handles a document at the node ceiling", () => {
    const doc = fiveThousandNodePage();
    const issues = validate(doc, ctx);
    // At exactly the cap the document is legal, so the size itself is not an
    // issue; this asserts the engine completes rather than that it is silent.
    expect(
      issues.filter(issue => issue.code === "node-count-exceeded")
    ).toEqual([]);
  });
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

  it("migrates the same way through the counting document", () => {
    const doc = staleVersionPage(50, 1);
    const tally = { reads: 0 };

    expect(migrateDocument(tallyingReads(doc, tally), source).doc).toEqual(
      migrateDocument(doc, source).doc
    );
    expect(tally.reads).toBeGreaterThan(0);
  });

  it("does not do super-linear work when the document grows four times", () => {
    const small = readsTaken(
      staleVersionPage(SMALL_NODES, 1),
      doc => void migrateDocument(doc, source)
    );
    const large = readsTaken(
      staleVersionPage(LARGE_NODES, 1),
      doc => void migrateDocument(doc, source)
    );
    const growth = large / small;

    expect(
      growth,
      `migrating ${LARGE_NODES} nodes read ${growth.toFixed(3)}x as much of the document as ${SMALL_NODES} (${small} then ${large}); linear work reads about 4x`
    ).toBeLessThan(MAX_GROWTH_FACTOR);
  });
});
