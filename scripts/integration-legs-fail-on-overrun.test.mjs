/**
 * An integration leg that outgrows its budget must FAIL, not vanish.
 *
 * GitHub enforces a job's `timeout-minutes` by cancelling it, so a leg killed
 * for running too long is recorded as `conclusion: cancelled` rather than
 * `failure`. Nothing reads a cancellation as a verdict — branch protection
 * ignores it and the checks rollup shows no red — so the leg silently stops
 * contributing an answer while looking like somebody pressed the button.
 *
 * It has happened twice. At the 25-minute ceiling the MySQL leg stopped
 * reporting for six consecutive rounds of merges. At 45 it killed three
 * separate branches in one day, and all three read as cancellations.
 *
 * Raising the ceiling is what was done the first time, and it left the trap
 * armed. So the real bound lives on the STEP, in `run-with-budget.sh`, where an
 * overrun exits non-zero and the job fails like any other red.
 *
 * ## Every assertion here derives its population from the workflow
 *
 * The first version of this file did not, and that is the defect it exists to
 * prevent, committed inside the guard against it. It iterated a three-item list
 * of dialects written HERE, so a fourth leg added to the workflow alone — the
 * exact regression the file claims to catch — was outside the population and
 * every assertion passed without ever looking at it.
 *
 * So a leg is anything the workflow runs a `lane:test:integration:` script for,
 * and a job is anything `jobs:` declares. A floor check keeps that from failing
 * open: if the reader finds no legs at all, an assertion over "every leg" is
 * satisfied by having nothing to check.
 *
 * ## And each assertion tests a RELATIONSHIP, not a coincidence
 *
 * Asserting that a block contains the wrapper and contains the lane script is
 * satisfied by a block that runs the lane bare and calls the wrapper on
 * something else entirely. What has to hold is that the wrapper INVOKES the
 * lane, so the commands are joined across their line continuations and read as
 * one.
 *
 * @module integration-legs-fail-on-overrun.test
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { jobIds, jobTimeouts, workflowSteps } from "./workflow-run-blocks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(
  HERE,
  "..",
  ".github",
  "workflows",
  "integration.yml"
);

const LANE = "lane:test:integration:";
const WRAPPER = "scripts/run-with-budget.sh";

/**
 * The dialects that must be present for the reader to be believed.
 *
 * A FLOOR, not the population. Every assertion below iterates what the workflow
 * actually declares; this one exists so a reader that silently found nothing
 * cannot satisfy them all by leaving them nothing to iterate.
 */
const AT_LEAST = ["postgres", "mysql", "sqlite"];

/**
 * What a job's ceiling must clear beyond the suite's own budget.
 *
 * The suite may use its whole budget, then ignore TERM and take the escalation
 * delay on top, and the job has already spent time on checkout, install and
 * build before any of that. A ceiling only just above the budget cancels the
 * job mid-escalation — which is the cancellation this whole mechanism exists to
 * replace, restored by a number that looks like it has headroom.
 */
const ESCALATION_MINUTES = 2;
const SETUP_MINUTES = 5;

let workflow = "";

beforeAll(async () => {
  workflow = await readFile(WORKFLOW, "utf8");
});

/**
 * Shell lines with their `\` continuations joined, so one command is one line.
 *
 * The wrapper invocation spans three physical lines. Read line by line, the
 * line naming the lane script does not name the wrapper, and no assertion about
 * the two together can hold.
 */
function commands(block) {
  return block
    .replace(/\\\n\s*/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** Every step whose script runs one of the integration lane scripts. */
function integrationLegs(text) {
  return [...workflowSteps(text).blocks.entries()].filter(([, block]) =>
    block.includes(LANE)
  );
}

/**
 * True when the wrapper is what invokes the lane on this command.
 *
 * The ORDER is the check. A command merely containing both strings is satisfied
 * by a block that calls the wrapper on something else and the lane bare beside
 * it, which is precisely the unbounded state being guarded against.
 */
function wrapsLane(command) {
  if (!command.includes(WRAPPER)) return false;
  return command.indexOf(WRAPPER) < command.indexOf(LANE);
}

/** The lane invocations in one block that do NOT go through the wrapper. */
function bareInvocations(name, block) {
  return commands(block)
    .filter((command) => command.includes(LANE) && !wrapsLane(command))
    .map((command) => `${name}: ${command}`);
}

describe("integration.yml", () => {
  it("declares a leg for at least every dialect the suite is known to run", () => {
    // The floor. Without it, a reader that returned nothing would make every
    // "for each leg" assertion below vacuously true.
    const found = integrationLegs(workflow)
      .map(([name]) => name)
      .join(" ");

    for (const dialect of AT_LEAST) {
      expect(found).toContain(dialect);
    }
  });

  it("runs EVERY lane it invokes through the budget wrapper", () => {
    // Derived from the workflow, so a dialect added later is covered without
    // anybody remembering to edit this file.
    const bare = integrationLegs(workflow).flatMap(([name, block]) =>
      bareInvocations(name, block)
    );

    expect(bare).toEqual([]);
  });

  it("names each leg's step only once, so none can hide another", () => {
    // Two steps may share a name legitimately. The reader keeps the last, so a
    // wrapped later step would hide an unwrapped earlier one — and this gate
    // would pass on the strength of the step it did not read.
    expect(workflowSteps(workflow).duplicated).toEqual([]);
  });

  it("gives EVERY job a ceiling, with room for the escalation and the setup", () => {
    const budget = /INTEGRATION_SUITE_BUDGET:\s*(\d+)m/.exec(workflow);
    expect(budget, "the workflow declares a step budget").not.toBeNull();

    // Non-zero, because GNU `timeout` documents a duration of 0 as DISABLING
    // the bound. `run-with-budget.sh` refuses one at run time; catching it here
    // means the workflow cannot be merged in that state at all.
    expect(Number(budget[1])).toBeGreaterThan(0);

    const floor = Number(budget[1]) + ESCALATION_MINUTES + SETUP_MINUTES;
    const ceilings = jobTimeouts(workflow);
    const ids = jobIds(workflow);

    // Non-empty, or "every job clears the floor" is true of no jobs at all.
    expect(ids.length).toBeGreaterThan(0);

    // Per job, by id. One list of every number in the file is satisfied by the
    // siblings of a job whose own ceiling was deleted.
    for (const id of ids) {
      expect(
        ceilings.get(id),
        `${id} declares no timeout-minutes`
      ).toBeDefined();
      expect(
        ceilings.get(id),
        `${id} leaves no room above the budget`
      ).toBeGreaterThanOrEqual(floor);
    }
  });
});
