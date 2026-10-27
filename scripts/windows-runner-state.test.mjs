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

describe("the gates whose failure lets later gates run", () => {
  const steps = workflow.jobs["windows-gates"].steps;
  it.each(["lint", "typecheck"])("%s is followed at once by a look at the runner, on its own failure", id => {
    const index = steps.findIndex(step => step.id === id);
    expect(index).toBeGreaterThan(-1);
    const next = steps[index + 1];
    expect(next.uses).toBe(ACTION);
    expect(next.if).toBe(`\${{ !cancelled() && steps.${id}.outcome == 'failure' }}`);
    expect(next["continue-on-error"]).toBe(true);
  });
});

describe("the windows-runner-state action", () => {
  const script = load(read(".github/actions/windows-runner-state/action.yml")).runs.steps.map(step => step.run ?? "").join("\n");
  // The script with its comments and quoted strings removed, so only code is judged.
  const code = script
    .split("\n")
    .map(line => line.replace(/#.*$/, "").replace(/'[^']*'/g, "''"))
    .join("\n");

  /**
   * Every command the script may run. A positive list, not a list of forbidden
   * spellings: PowerShell reads the environment and files in more ways than any
   * blacklist names (`${env:X}`, `Get-Item env:X`, aliases, .NET calls), and each
   * is a command or construct this list does not hold.
   */
  const COMMANDS = [
    "Format-List",
    "Format-Table",
    "Get-ChildItem",
    "Get-CimInstance",
    "Get-Date",
    "Get-Process",
    "Get-PSDrive",
    "Get-WinEvent",
    "Out-String",
    "Select-Object",
    "Sort-Object",
    "Where-Object",
  ];
  /** Every variable it may read: its own, and the temporary directory's path. */
  const VARIABLES = ["$ErrorActionPreference", "$_", "$env:TEMP", "$os", "$since"];

  it("runs only the commands on the list", () => {
    const used = [...new Set(code.match(/\b[A-Z][a-z]+-[A-Za-z]+\b/g) ?? [])];
    expect(used.length).toBeGreaterThan(5);
    expect(used.filter(command => !COMMANDS.includes(command))).toEqual([]);
  });

  it("starts every statement with a listed command, a string, an assignment of its own, or exit", () => {
    const statements = code
      .split(/\n|\|/)
      .map(statement => statement.trim())
      .filter(Boolean)
      // A line that continues the one before it (a property list, a calculated column) is not a statement.
      .filter(statement => !/^[,@{}()]/.test(statement));
    const odd = statements.filter(
      statement =>
        !COMMANDS.some(command => statement.startsWith(command)) &&
        !statement.startsWith("''") &&
        !/^\$(ErrorActionPreference|os|since) = /.test(statement) &&
        statement !== "exit 0"
    );
    expect(odd).toEqual([]);
  });

  it("reads no variable but its own and the temporary directory, in any spelling", () => {
    expect(code).not.toMatch(/\$\{/);
    const variables = [...new Set(code.match(/\$[\w:]+/g) ?? [])];
    expect(variables.filter(variable => !VARIABLES.includes(variable))).toEqual([]);
  });

  it("calls no .NET type but rounding, which could read a file or the environment past the command list", () => {
    expect(code).toMatch(/\[math\]::Round\(/);
    expect(code.replaceAll("[math]::Round(", "")).not.toMatch(/::|\[[A-Za-z][\w.]*\]/);
  });

  it("always exits 0, whatever its commands met", () => {
    expect(script.trim().split("\n").at(-1).trim()).toBe("exit 0");
  });
});
