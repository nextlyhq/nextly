/**
 * What each verification scope runs, and in what order.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { phasesFor } from "./verify.mjs";

/** The tasks a `turbo run <task>… <flags>` argument list names: those before its first flag. */
function turboTasksOf(argv) {
  const rest = argv.slice(2);
  const firstFlag = rest.findIndex(arg => arg.startsWith("-"));
  return firstFlag === -1 ? rest : rest.slice(0, firstFlag);
}

/** The tasks turbo.jsonc defines, read the way turbo reads it. */
function definedTasks() {
  const text = readFileSync(new URL("../turbo.jsonc", import.meta.url), "utf8");
  const withoutComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match, string) => string ?? "");
  return Object.keys(JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, "$1")).tasks);
}

const limits = { concurrency: 2, maxWorkers: 2 };
const names = scope => phasesFor(scope, limits).map(phase => phase.name);

describe("the phases a verification scope runs", () => {
  /*
   * 🔴 `turbo run test` does not reach `scripts/` — gate-scope.mjs records that
   * explicitly — so a change confined to the repository's own tooling passed
   * both documented entry points without running its tests, including the
   * tests for the resource-bound check itself.
   */
  it("runs the root script suite, which turbo does not reach", () => {
    expect(names("pr")).toContain("script tests");
    expect(names("full")).toContain("script tests");
  });

  it("builds before lint and typechecking, because both read what build produced", () => {
    const phases = names("pr");
    expect(phases.indexOf("build")).toBeLessThan(phases.indexOf("lint"));
    expect(phases.indexOf("build")).toBeLessThan(phases.indexOf("types"));
  });

  /*
   * turbo refuses a run that names a task the graph does not define, so a
   * phase left naming a removed task stops the whole verification there,
   * before the tests it was meant to reach.
   */
  it("names only tasks turbo.jsonc defines in each turbo phase", () => {
    const defined = new Set(definedTasks());
    expect(defined.has("build")).toBe(true);
    const turboPhases = phasesFor("full", limits).filter(phase => phase.argv[0] === "turbo");
    expect(turboPhases.length).toBeGreaterThan(0);
    for (const phase of turboPhases) {
      const tasks = turboTasksOf(phase.argv);
      expect(tasks.length, `phase '${phase.name}' names no task`).toBeGreaterThan(0);
      for (const task of tasks) {
        expect(defined.has(task), `phase '${phase.name}' runs '${task}'`).toBe(true);
      }
    }
  });

  /*
   * Every phase that runs tests, not just the first one. A second uncapped
   * phase is the shape that slipped through: the runner reported the derived
   * number while one of its phases ran one worker per core.
   */
  it("caps workers on every phase that runs tests", () => {
    for (const phase of phasesFor("full", limits)) {
      if (!/\btest\b/.test(phase.argv.join(" "))) continue;
      expect(phase.argv, `phase '${phase.name}' is uncapped`).toContain("--maxWorkers=2");
    }
  });

  /*
   * 🔴 `pnpm run <script> -- <args>` forwards the arguments but KEEPS the
   * separator, so vitest reads everything after `--` as a test-name filter
   * rather than as options: the cap is accepted, ignored, and the run reports
   * success. Measured with a deliberately invalid flag — through
   * `pnpm run ... --` it is ignored, passed directly it is rejected.
   *
   * turbo's `--` forwards options correctly, which is why only the `run` form
   * is forbidden here.
   */
  it("does not rely on pnpm run's -- to carry a cap, because it does not", () => {
    for (const phase of phasesFor("full", limits)) {
      if (phase.argv[0] !== "run") continue;
      expect(phase.argv, `phase '${phase.name}' passes options through 'pnpm run --'`)
        .not.toContain("--maxWorkers=2");
    }
  });

  /*
   * `full` extends `pr` rather than restating it, so the two cannot drift into
   * disagreeing about what a pull request needs.
   */
  it("extends the pr scope rather than restating it", () => {
    expect(names("full").slice(0, names("pr").length)).toEqual(names("pr"));
  });
});
