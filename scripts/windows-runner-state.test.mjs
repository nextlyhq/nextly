/**
 * The Windows gate jobs print the runner's state after a failure, through
 * `.github/actions/windows-runner-state`, without that step ever failing the
 * job on its own or printing what a step was handed.
 */
import { readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = load(read(".github/workflows/ci.yml"));
const WINDOWS_JOBS = Object.keys(workflow.jobs).filter(id => id.startsWith("windows-gates"));
const ACTION = "./.github/actions/windows-runner-state";

describe("the Windows gate jobs", () => {
  it("are found", () => {
    expect(WINDOWS_JOBS.sort()).toEqual(["windows-gates", "windows-gates-admin", "windows-gates-nextly"]);
  });

  it.each(WINDOWS_JOBS)("%s ends by printing the runner's state, only after a failure, and never failing for it", id => {
    const last = workflow.jobs[id].steps.at(-1);
    expect(last.uses).toBe(ACTION);
    expect(last.if).toBe("failure()");
    expect(last["continue-on-error"]).toBe(true);
  });
});

describe("the windows-runner-state action", () => {
  const script = load(read(".github/actions/windows-runner-state/action.yml")).runs.steps.map(step => step.run ?? "").join("\n");

  it("reads no environment variable but the temporary directory, and no file's contents", () => {
    expect(script.match(/\$env:\w+/gi) ?? []).toEqual(["$env:TEMP"]);
    expect(script).not.toMatch(/\benv:\\|Get-ChildItem\s+env:|\bgci\s+env:|Get-Content|\bcat\b|\btype\b|CommandLine/i);
  });

  it("always exits 0, whatever its commands met", () => {
    expect(script.trim().split("\n").at(-1).trim()).toBe("exit 0");
  });
});
