/**
 * `superseded-on-main` names the last commit a workflow tested: the newest run
 * on main in which EVERY job it is given reached a verdict. These cases run
 * the action's own `jq` filter, read from action.yml, over a run's jobs, so a
 * run where one leg was cancelled is shown not to count; and they hold the
 * scaffold build's list in ci.yml to every leg of scaffold-build.yml's matrix,
 * since one leg standing for the others would call such a run tested.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

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
