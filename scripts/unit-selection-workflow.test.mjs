/**
 * How `.github/workflows/ci.yml` wires the pull-request unit selection: each
 * unit lane narrows only when `scripts/merge-path.mjs` answers `select`, runs
 * its full suite on every other answer (including none), lets only a passing
 * push to `main` publish the records a later selection reads, and a push to
 * `main` checks every commit it brought came through the merge queue.
 *
 * Which events can answer `select` at all is `merge-path.test.mjs`'s; this file
 * holds the workflow to asking it, and to obeying the answer.
 */
import { readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const workflow = load(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));

/** Each unit lane's job and the root script that runs its full suite. */
const LANES = [
  { job: "ci", lane: "lane:test" },
  { job: "unit-tests-nextly", lane: "lane:test:nextly" },
  { job: "unit-tests-admin", lane: "lane:test:admin" },
];

// This workflow's `push` trigger is `main` alone, which the first test below holds.
const MAIN_PUSH_ONLY = "success() && github.event_name == 'push'";

/** The job's steps whose `run` is exactly `command`; the caller asserts how many. */
const stepsRunning = (steps, command) => steps.filter(step => String(step.run ?? "").trim() === command);
const stepNamed = (steps, name) => steps.find(step => step.name === name);

it("is pushed to on main alone, so a push-only step is a main-only step", () => {
  expect(workflow.on.push).toEqual({ branches: ["main"] });
});

describe.each(LANES)("the $job job", ({ job, lane }) => {
  const steps = workflow.jobs[job]?.steps ?? [];

  it("is found, with its full suite step", () => {
    expect(steps.length).toBeGreaterThan(5);
    expect(stepsRunning(steps, `pnpm ${lane}`)).toHaveLength(1);
  });

  it("asks merge-path how to test, with the switch from the repository variable", () => {
    const decide = stepNamed(steps, "Decide how this run tests its units");
    expect(decide?.run).toContain("node scripts/merge-path.mjs select");
    expect(decide?.env?.NEXTLY_PR_TEST_SELECTION).toBe("${{ vars.NEXTLY_PR_TEST_SELECTION }}");
  });

  it("runs the full suite on every answer but select, and narrows only on select", () => {
    const [full] = stepsRunning(steps, `pnpm ${lane}`);
    const [narrowed] = stepsRunning(steps, `node scripts/ci-unit-lane.mjs run ${lane}`);
    expect(full.if).toContain("env.NEXTLY_UNIT_TESTS != 'select'");
    expect(full.if).not.toMatch(/NEXTLY_UNIT_TESTS ==/);
    expect(narrowed?.if).toContain("env.NEXTLY_UNIT_TESTS == 'select'");
  });

  it("publishes records only after a passing push to main", () => {
    const save = stepNamed(steps, "Save unit test records");
    const stamp = stepNamed(steps, "Stamp unit test records");
    expect(save?.uses).toMatch(/^actions\/cache\/save@/);
    expect(save?.if).toBe(MAIN_PUSH_ONLY);
    expect(stamp?.if).toBe(MAIN_PUSH_ONLY);
    expect(stamp?.run).toContain(`ci-unit-lane.mjs stamp ${lane}`);
  });

  it("restores the records it narrows by, and saves under the key it restores from", () => {
    const restore = stepNamed(steps, "Restore unit test records");
    const save = stepNamed(steps, "Save unit test records");
    expect(restore?.uses).toMatch(/^actions\/cache\/restore@/);
    expect(restore?.with?.path).toBe(save?.with?.path);
    expect(restore?.with?.key).toBe(save?.with?.key);
  });
});

describe("the merge-queue tripwire", () => {
  const job = workflow.jobs["selection-tripwire"];

  it("runs on each push to main while the switch is on", () => {
    expect(job?.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.NEXTLY_PR_TEST_SELECTION == 'on'");
  });

  it("checks the push's own range, and may read the runs it judges by", () => {
    const step = job?.steps?.find(candidate => String(candidate.run ?? "").includes("merge-path.mjs tripwire"));
    expect(step?.env).toMatchObject({ BEFORE: "${{ github.event.before }}", AFTER: "${{ github.sha }}" });
    expect(step?.run).toContain('tripwire "$BEFORE" "$AFTER"');
    expect(job?.permissions).toEqual({ contents: "read", actions: "read" });
  });
});
