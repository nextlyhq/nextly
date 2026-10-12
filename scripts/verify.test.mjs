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
