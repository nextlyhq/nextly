/**
 * `superseded-on-main` names the last commit a workflow tested: the newest run
 * on main in which EVERY job it is given reached a verdict. These cases run
 * the action's own `jq` filter, read from action.yml, over a run's jobs, so a
 * run where one leg was cancelled is shown not to count; and they hold the
 * scaffold build's list in ci.yml to every leg of scaffold-build.yml's matrix,
 * since one leg standing for the others would call such a run tested.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** The filter the action applies to one run's jobs, as action.yml writes it. */
function verdictFilter() {
  const action = load(read(".github/actions/superseded-on-main/action.yml"));
  const script = action.runs.steps.map(step => step.run ?? "").join("\n");
  const match = /jq -r --arg names "\$SUBSTANTIVE_JOB" '([\s\S]*?)'\)/.exec(script);
  if (!match) throw new Error("action.yml no longer has the verdict filter this reads");
  return match[1];
}

/** What the action makes of a run whose jobs are `jobs`, given `names`: "verdict" or "none". */
function judge(names, jobs) {
  const result = spawnSync("jq", ["-r", "--arg", "names", names.join("\n"), verdictFilter()], {
    input: JSON.stringify({ jobs }),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`jq failed: ${result.stderr}`);
  return result.stdout.trim();
}

const ci = load(read(".github/workflows/ci.yml"));
const scaffoldBuild = load(read(".github/workflows/scaffold-build.yml"));

/** The scaffold legs as their runs on main name them: the caller's job, then the leg. */
const scaffoldLegs = () => {
  const job = Object.values(scaffoldBuild.jobs).find(entry => entry.strategy?.matrix?.include);
  return job.strategy.matrix.include.map(
    leg => `${ci.jobs["scaffold-build"].name} / ${String(job.name).replace("${{ matrix.name }}", leg.name)}`
  );
};

/** The names the scaffold scope job hands the action. */
const scopeNames = () => {
  const ask = ci.jobs["scaffold-build-scope"].steps.find(step => String(step.uses).includes("superseded-on-main"));
  return String(ask.with["substantive-job"]).split("\n").map(name => name.trim()).filter(Boolean);
};

describe("which run superseded-on-main reads as the last tested", () => {
  const legs = ["Scaffold build / Scaffold blank", "Scaffold build / Scaffold blog-code-first"];

  it("a run in which every named job passed or failed", () => {
    expect(judge(legs, [{ name: legs[0], conclusion: "success" }, { name: legs[1], conclusion: "failure" }])).toBe("verdict");
  });

  it("not a run in which one named leg was cancelled, though the others reached a verdict", () => {
    expect(judge(legs, [{ name: legs[0], conclusion: "cancelled" }, { name: legs[1], conclusion: "success" }])).toBe("none");
  });

  it("not a run missing one of the named jobs", () => {
    expect(judge(legs, [{ name: legs[1], conclusion: "success" }])).toBe("none");
  });
});

describe("the scaffold build's scope on main", () => {
  it("names every leg of scaffold-build.yml's matrix, so one cancelled leg leaves a commit untested", () => {
    expect(scopeNames()).toEqual(scaffoldLegs());
  });

  it("reads a run with every leg passed as tested, and one with any leg cancelled as not", () => {
    const names = scopeNames();
    const all = names.map(name => ({ name, conclusion: "success" }));
    expect(judge(names, all)).toBe("verdict");
    for (const cancelled of names) {
      const jobs = all.map(job => (job.name === cancelled ? { ...job, conclusion: "cancelled" } : job));
      expect(judge(names, jobs), cancelled).toBe("none");
    }
  });
});

/**
 * The action's `Ask` step run by bash for one event and ref, with `gh` a stub
 * that records its arguments and lists no runs. Returns what the step wrote to
 * its outputs and the `gh` calls it made.
 */
const scratch = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function ask({ event, ref }) {
  const dir = mkdtempSync(join(tmpdir(), "superseded-"));
  scratch.push(dir);
  const calls = join(dir, "calls");
  writeFileSync(join(dir, "gh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\n`);
  chmodSync(join(dir, "gh"), 0o755);
  const output = join(dir, "output");
  writeFileSync(output, "");
  writeFileSync(calls, "");
  const action = load(read(".github/actions/superseded-on-main/action.yml"));
  const step = action.runs.steps.find(entry => entry.id === "ask");
  const result = spawnSync("bash", ["-c", step.run], {
    encoding: "utf8",
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_OUTPUT: output,
      EVENT: event,
      REF: ref,
      WORKFLOW: "ci.yml",
      SUBSTANTIVE_JOB: "Lint",
      REPO: "nextlyhq/nextly",
      THIS_RUN: "7",
      THIS_SHA: "a".repeat(40),
      GH_TOKEN: "t",
    },
  });
  if (result.status !== 0) throw new Error(`the step failed: ${result.stderr}`);
  return { outputs: readFileSync(output, "utf8"), calls: readFileSync(calls, "utf8"), stdout: result.stdout };
}

describe("which pushes superseded-on-main asks about", () => {
  it("a push to main reads main's runs, and a push to dev reads dev's", () => {
    for (const branch of ["main", "dev"]) {
      const { calls, stdout } = ask({ event: "push", ref: `refs/heads/${branch}` });
      expect(calls, branch).toContain(`runs?branch=${branch}&per_page=100`);
      expect(stdout, branch).toContain(`could not list runs of ci.yml on ${branch}`);
    }
  });

  it("asks nothing for a pull request, a dispatch or a push to any other branch", () => {
    for (const [event, ref] of [
      ["pull_request", "refs/pull/1/merge"],
      ["workflow_dispatch", "refs/heads/dev"],
      ["push", "refs/heads/feature"],
    ]) {
      const { calls, outputs } = ask({ event, ref });
      expect(calls, `${event} ${ref}`).toBe("");
      expect(outputs, `${event} ${ref}`).toBe("superseded=false\nlast_tested_sha=\n");
    }
  });
});
