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

describe("the steps whose failure lets later work run", () => {
  // A step that runs a command, whatever the command, can be the one that fails.
  const isWork = step => typeof step.run === "string";
  const freeing = steps => {
    const byId = new Map(steps.filter(step => step.id).map(step => [step.id, step]));
    // The steps a step needs to have succeeded, through every step those need in turn.
    const needs = (step, seen = new Set()) => {
      for (const [, id] of String(step.if ?? "").matchAll(/steps\.([\w-]+)\.outcome == 'success'/g)) {
        if (!seen.has(id)) {
          seen.add(id);
          needs(byId.get(id), seen);
        }
      }
      return seen;
    };
    // Later work that runs past a failure and doesn't need this step to have succeeded.
    const freesLaterWork = index =>
      steps
        .slice(index + 1)
        .some(later => isWork(later) && /!cancelled\(\)|always\(\)/.test(later.if ?? "") && !needs(later).has(steps[index].id));
    return steps.flatMap((step, index) => (isWork(step) && freesLaterWork(index) ? [step] : []));
  };
  const cases = WINDOWS_JOBS.flatMap(id => freeing(workflow.jobs[id].steps).map(step => [id, step.name, step]));

  it("are found from the steps' own conditions", () => {
    expect(Object.fromEntries(WINDOWS_JOBS.map(id => [id, freeing(workflow.jobs[id].steps).map(step => step.id)]))).toEqual({
      "windows-gates": ["limits", "design-lint", "workspace-lint", "scripts-lint", "lint", "typecheck"],
      "windows-gates-admin": [],
      "windows-gates-nextly": [],
    });
  });

  it.each(cases)("%s: %s is followed at once by a look at the runner, on its own failure", (id, _, step) => {
    const steps = workflow.jobs[id].steps;
    const next = steps[steps.indexOf(step) + 1];
    expect(next.uses).toBe(ACTION);
    expect(next.if).toBe(`\${{ !cancelled() && steps.${step.id}.outcome == 'failure' }}`);
    expect(next["continue-on-error"]).toBe(true);
  });
});

describe("the windows-runner-state action", () => {
  const script = load(read(".github/actions/windows-runner-state/action.yml")).runs.steps.map(step => step.run ?? "").join("\n");
  // Its lines of code, without whole-line comments or indentation.
  const code = script
    .split("\n")
    .map(line => line.replace(/^\s*#.*$/, "").trim())
    .filter(Boolean);

  /**
   * Every line the script may run, in full. A list of complete invocations, not
   * of command names: an allowed cmdlet reads what its arguments name
   * (`Get-ChildItem env:` lists the environment), and an allowed formatter
   * prints what its arguments pick (`Select-Object CommandLine` prints how each
   * process was started). Each line here was reviewed to print the machine,
   * never what a step was handed, so changing what the action runs means
   * changing this list, where that review is asked for again.
   */
  const REVIEWED = [
    "$ErrorActionPreference = 'Continue'",
    "'== Disks'",
    "Get-PSDrive -PSProvider FileSystem |",
    "Format-Table Name, @{ n = 'UsedGB'; e = { [math]::Round($_.Used / 1GB, 1) } }, @{ n = 'FreeGB'; e = { [math]::Round($_.Free / 1GB, 1) } } -AutoSize |",
    "Out-String -Width 200",
    "'== Memory and commit charge'",
    "$os = Get-CimInstance Win32_OperatingSystem",
    "'Physical: {0:N1} GB free of {1:N1} GB' -f ($os.FreePhysicalMemory / 1MB), ($os.TotalVisibleMemorySize / 1MB)",
    "'Commit: {0:N1} GB free of {1:N1} GB' -f ($os.FreeVirtualMemory / 1MB), ($os.TotalVirtualMemorySize / 1MB)",
    "'== The ten processes holding the most memory (names only)'",
    "Get-Process |",
    "Sort-Object WorkingSet64 -Descending |",
    "Select-Object -First 10 Name, Id, @{ n = 'WorkingSetMB'; e = { [math]::Round($_.WorkingSet64 / 1MB) } } |",
    "Format-Table -AutoSize | Out-String -Width 200",
    "'== Application errors in the last hour'",
    "Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 1, 2; StartTime = (Get-Date).AddHours(-1) } -MaxEvents 20 -ErrorAction SilentlyContinue |",
    "Format-List TimeCreated, ProviderName, Id, Message | Out-String -Width 200",
    "'== Crash reports from the last two hours (names only)'",
    "$since = (Get-Date).AddHours(-2)",
    "Get-ChildItem -Path $env:TEMP -Recurse -File -Include 'report-*.toml', '*turbo*' -ErrorAction SilentlyContinue |",
    "Where-Object { $_.LastWriteTime -ge $since } |",
    "Select-Object -First 10 FullName, Length, LastWriteTime |",
    "Format-Table -AutoSize | Out-String -Width 200",
    "exit 0",
  ];

  it("runs exactly the reviewed lines, in order", () => {
    expect(code).toEqual(REVIEWED);
  });

  it("always exits 0, whatever its commands met", () => {
    expect(code.at(-1)).toBe("exit 0");
  });
});
