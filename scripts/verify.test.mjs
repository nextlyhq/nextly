/**
 * What each verification scope runs, and in what order.
 */
import { describe, expect, it } from "vitest";

import { phasesFor } from "./verify.mjs";

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

  it("builds before typechecking, because check-types reads what build produced", () => {
    const phases = names("pr");
    expect(phases.indexOf("build")).toBeLessThan(phases.indexOf("lint + types"));
  });

  it("caps workers on the phase that spawns them", () => {
    const tests = phasesFor("pr", limits).find(phase => phase.name === "unit tests");
    expect(tests.argv).toContain("--maxWorkers=2");
  });

  /*
   * `full` extends `pr` rather than restating it, so the two cannot drift into
   * disagreeing about what a pull request needs.
   */
  it("extends the pr scope rather than restating it", () => {
    expect(names("full").slice(0, names("pr").length)).toEqual(names("pr"));
  });
});
