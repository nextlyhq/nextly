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
 * ## Every assertion here derives its population from the artifacts
 *
 * The first version of this file did not, and that is the defect it exists to
 * prevent, committed inside the guard against it. It iterated a three-item list
 * of dialects written HERE, so a fourth leg added to the workflow alone — the
 * exact regression the file claims to catch — was outside the population and
 * every assertion passed without ever looking at it.
 *
 * So a leg is anything the workflow runs a `lane:test:integration:` script for,
 * a job is anything `jobs:` declares, and the escalation delay is read from the
 * script that enforces it rather than repeated here. A floor check keeps the
 * derivation from failing open: if the reader finds no legs at all, an
 * assertion over "every leg" is satisfied by having nothing to check.
 *
 * ## And each assertion tests a RELATIONSHIP, not a coincidence
 *
 * A block containing the wrapper and containing the lane script is satisfied by
 * one that runs the lane bare beside a wrapper call on something else. String
 * ORDER does not settle it either: `wrapper ... true && pnpm lane:...` puts the
 * wrapper first and still runs the lane unbounded. So each script is split into
 * its simple commands — across line continuations, and at `&&`, `||`, `;` and
 * `|` — and the wrapper must be the command that invokes the lane.
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
const SCRIPT = path.join(HERE, "run-with-budget.sh");

const LANE = /\blane:test:integration:([a-z0-9]+)/;
const WRAPPER = "scripts/run-with-budget.sh";

/**
 * The dialects that must be present for the reader to be believed.
 *
 * A FLOOR, not the population. Every assertion below iterates what the workflow
 * actually invokes; this one exists so a reader that silently found nothing
 * cannot satisfy them all by leaving them nothing to iterate. Checked against
 * the LANE SCRIPTS the steps run, not their display names — a step still named
 * `(postgres)` that had been changed to run the MySQL lane would otherwise
 * count as postgres coverage.
 */
const AT_LEAST = ["postgres", "mysql", "sqlite"];

/**
 * Time the job needs beyond the budget and the escalation for checkout,
 * install and build, which all run before the suite's clock starts.
 */
const SETUP_MINUTES = 5;

let workflow = "";
let script = "";

beforeAll(async () => {
  [workflow, script] = await Promise.all([
    readFile(WORKFLOW, "utf8"),
    readFile(SCRIPT, "utf8"),
  ]);
});

/**
 * Every simple command in a script, one per element.
 *
 * Line continuations are joined first, so the wrapper's three physical lines
 * read as one invocation. Then each line is split at the shell operators, so
 * `a && b` is two commands — and a lane in `b` cannot borrow a wrapper in `a`.
 * Quoted operators are not special-cased: nothing in this workflow quotes one,
 * and a reader that mis-split a quoted `|` would err toward reporting a bare
 * lane, which is the loud direction.
 */
function simpleCommands(block) {
  return block
    .replace(/\\\n\s*/g, " ")
    .split("\n")
    .flatMap(line => line.split(/\s*(?:&&|\|\||;|\|)\s*/))
    .map(command => command.trim())
    .filter(command => command !== "" && !command.startsWith("#"));
}

/** The dialects a script invokes, by lane name. */
function dialectsInvoked(block) {
  // `matchAll` requires the global flag, and that flag is what makes `.test()`
  // stateful — so the global copy lives here, and nowhere else.
  return [...block.matchAll(new RegExp(LANE.source, "g"))].map(m => m[1]);
}

/**
 * True when the wrapper is the command invoking the lane.
 *
 * Within one SIMPLE command, order is enough: there is no operator left for a
 * wrapper to hide behind, so the wrapper appearing before the lane means the
 * lane is one of its arguments.
 */
function wrapsLane(command) {
  const wrapper = command.indexOf(WRAPPER);
  return wrapper !== -1 && wrapper < command.search(LANE);
}

/** The lane invocations in one script that do NOT go through the wrapper. */
function bareInvocations(name, block) {
  return simpleCommands(block)
    .filter(command => LANE.test(command) && !wrapsLane(command))
    .map(command => `${name ?? "(unnamed step)"}: ${command}`);
}

/** The escalation delay the SCRIPT enforces, in minutes. */
function escalationMinutes(text) {
  const found = /^KILL_AFTER=(\d+)m$/m.exec(text);
  expect(found, "run-with-budget.sh declares KILL_AFTER in minutes").not.toBeNull();
  return Number(found[1]);
}

describe("integration.yml", () => {
  it("invokes a lane for at least every dialect the suite is known to run", () => {
    // The floor. Without it, a reader that returned nothing would make every
    // "for each leg" assertion below vacuously true.
    const invoked = workflowSteps(workflow).flatMap(step =>
      dialectsInvoked(step.block)
    );

    for (const dialect of AT_LEAST) {
      expect(invoked).toContain(dialect);
    }
  });

  it("runs EVERY lane it invokes through the budget wrapper", () => {
    // Derived from the workflow — named steps and anonymous ones alike — so a
    // dialect added later is covered without anybody editing this file.
    const bare = workflowSteps(workflow).flatMap(step =>
      bareInvocations(step.name, step.block)
    );

    expect(bare).toEqual([]);
  });

  it("gives EVERY job a ceiling, with room for the escalation and the setup", () => {
    const budget = /INTEGRATION_SUITE_BUDGET:\s*(\d+)m/.exec(workflow);
    expect(budget, "the workflow declares a step budget").not.toBeNull();

    // Non-zero, because GNU `timeout` documents a duration of 0 as DISABLING
    // the bound. `run-with-budget.sh` refuses one at run time; catching it here
    // means the workflow cannot be merged in that state at all.
    expect(Number(budget[1])).toBeGreaterThan(0);

    // The escalation comes from the script that performs it. A copy of the
    // number here would agree today and drift the first time the script's
    // changed alone — and the drift would only show as a job cancelled during
    // an escalation this guard had certified there was room for.
    const floor =
      Number(budget[1]) + escalationMinutes(script) + SETUP_MINUTES;
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
