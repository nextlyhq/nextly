/**
 * An integration leg that outgrows its budget must FAIL, not vanish.
 *
 * GitHub enforces a job's `timeout-minutes` by cancelling it, so a leg killed
 * for running too long is recorded as `conclusion: cancelled`. Nothing reads a
 * cancellation as a verdict — branch protection ignores it and the checks
 * rollup shows no red — so the leg silently stops contributing an answer while
 * looking
 * like somebody pressed the button.
 *
 * It has happened twice. At the 25-minute ceiling the MySQL leg stopped
 * reporting for six consecutive pull requests. At 45 it killed three separate
 * branches in one day, and all three read as cancellations.
 *
 * Raising the ceiling is what was done the first time, and it left the trap
 * armed. So the real bound now lives on the STEP, in `run-with-budget.sh`,
 * where an overrun exits non-zero and the job fails like any other red.
 *
 * 🔴 Nothing else in the repository reads this. A dialect added later that
 * calls its lane script directly gets the old behaviour back — silently, and
 * only for the new leg, which is the hardest version to notice. That is what
 * this file is for.
 *
 * ## Why these three assertions and not a simpler one
 *
 * Counting is what a first version of this did, and a count cannot see the
 * defect it exists to catch: a fourth leg added without the wrapper moves the
 * total, and a total compared against a hardcoded number either fails for
 * every legitimate addition or gets bumped without anyone checking WHICH legs
 * are covered. So membership is asserted per dialect, by name.
 *
 * The budget comparison is the non-obvious one. The step bound only does
 * anything if it fires FIRST — a job whose `timeout-minutes` is below the step
 * budget cancels on its way to the failure, and the whole mechanism reverts to
 * the behaviour being removed while every step still visibly calls the wrapper.
 *
 * The workflow is read through `workflow-run-blocks.mjs`, which pins the
 * reader's own traps — chiefly that a step's block must not absorb the comment
 * introducing the NEXT step, since these comments quote commands verbatim.
 *
 * @module integration-legs-fail-on-overrun.test
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { runBlocks } from "./workflow-run-blocks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(HERE, "..", ".github", "workflows", "integration.yml");

/** Every dialect the suite runs. A new one added here must be wired too. */
const DIALECTS = ["postgres", "mysql", "sqlite"];

let workflow = "";

beforeAll(async () => {
  workflow = await readFile(WORKFLOW, "utf8");
});

describe("integration.yml", () => {
  it("has a run block for every dialect's suite", () => {
    // The population, asserted before anything is judged about it. Every
    // assertion below is satisfied vacuously by a file this parser could not
    // read — an empty map passes "none of them skips the wrapper" perfectly.
    const named = [...runBlocks(workflow).keys()];

    for (const dialect of DIALECTS) {
      expect(named).toContain(`Run integration tests (${dialect})`);
    }
  });

  it.each(DIALECTS)(
    "runs the %s suite through the budget wrapper, not bare",
    (dialect) => {
      const block = runBlocks(workflow).get(
        `Run integration tests (${dialect})`
      );

      expect(block).toBeDefined();
      // Both halves matter. The lane script must be invoked (or this leg tests
      // nothing), and the invocation must go through the wrapper (or an
      // overrun is a cancellation again).
      expect(block).toContain(`lane:test:integration:${dialect}`);
      expect(block).toContain("scripts/run-with-budget.sh");
    }
  );

  it("gives every job a ceiling ABOVE the step budget, so the step fires first", () => {
    const budget = /INTEGRATION_SUITE_BUDGET:\s*(\d+)m/.exec(workflow);
    expect(budget, "the workflow declares a step budget").not.toBeNull();

    const ceilings = [...workflow.matchAll(/^\s*timeout-minutes:\s*(\d+)\s*$/gm)]
      .map((m) => Number(m[1]));

    // Nonzero, because "every ceiling exceeds the budget" is true of no
    // ceilings at all — and a regex that stopped matching would read as a pass.
    expect(ceilings.length).toBeGreaterThan(0);

    for (const ceiling of ceilings) {
      expect(ceiling).toBeGreaterThan(Number(budget[1]));
    }
  });
});
