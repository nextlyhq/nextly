/**
 * The Windows jobs in `ci.yml` run the gates `.husky/pre-push` runs, no more
 * and no fewer.
 *
 * The hook skips itself in CI, so the jobs list the hook's gates on their own.
 * A gate added to one and not the other would leave a Windows-only failure in
 * it unreported, or report one the hook never meets.
 *
 * The unit suites are split across the jobs, so the split is checked too: the
 * jobs together run each workspace's suite once. turbo is asked which suites
 * each job's filters select, as `check-test-lanes.mjs` asks it for the Linux
 * lanes, so a filter is never read here for what it means.
 *
 * A gate is read as a line that runs `pnpm`, after any environment assignments
 * or a leading `if !`, and is named by what it runs: the script for
 * `pnpm <script>` and `pnpm run <script>`, the task for `pnpm turbo <task>`.
 * Its options are not compared, since the hook narrows `turbo test` to what a
 * push affects and the job runs every workspace. A gate written another way,
 * such as `node scripts/…`, is not read, so give a new gate a `pnpm` script.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import { packagesInPlan } from "./check-test-lanes.mjs";
import { parseTurboPlan } from "./turbo-plan.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Each plan is a turbo start, which takes seconds, and Vitest allows a case five. */
const PLAN_TIMEOUT_MS = 180_000;

/** Installing dependencies prepares the job; it is not a gate. */
const NOT_GATES = new Set(["install"]);

const PNPM_LINE = /^\s*(?:if\s+!\s+)?(?:[A-Z_]+=\S+\s+)*pnpm\s+(.+)$/;

/** The gates the lines of a script run, by name. */
export function gatesIn(text) {
  const gates = new Set();
  for (const line of text.split("\n")) {
    const match = PNPM_LINE.exec(line);
    if (!match) continue;
    const [first, second] = match[1].trim().split(/\s+/);
    const name =
      first === "turbo" ? `turbo ${second}` : first === "run" ? second : first;
    if (!NOT_GATES.has(name)) gates.add(name);
  }
  return gates;
}

const TURBO_TEST_LINE = /^\s*pnpm\s+turbo\s+test\b(.*)$/m;

const FILTER = /--filter=(?:'([^']*)'|(\S+))/g;

/** The `--filter` values on a script's `turbo test` line, or null when it has no such line. */
export function testFiltersIn(text) {
  const line = TURBO_TEST_LINE.exec(text);
  if (!line) return null;
  return [...line[1].matchAll(FILTER)].map(match => match[1] ?? match[2]);
}

/** The workspaces whose suites turbo runs when `turbo test` is given these filters. */
function suitesRun(filters) {
  const raw = execFileSync(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "test",
      "--dry=json",
      ...filters.map(filter => `--filter=${filter}`),
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  return packagesInPlan(
    parseTurboPlan(raw, "turbo run test --dry=json"),
    "test"
  );
}

const hookGates = gatesIn(
  readFileSync(join(root, ".husky", "pre-push"), "utf8")
);
const jobs = load(
  readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8")
).jobs;
/** The script of each Windows job: the steps it runs, joined. */
const windowsJobs = Object.keys(jobs)
  .filter(key => key.startsWith("windows-gates"))
  .map(key => jobs[key].steps.map(step => step.run ?? "").join("\n"));
const jobGates = gatesIn(windowsJobs.join("\n"));

describe("the Windows jobs and the pre-push hook", () => {
  it("reads the gates the hook runs, so an empty match cannot pass", () => {
    for (const gate of [
      "lint:design",
      "build",
      "turbo check-types",
      "turbo test",
    ]) {
      expect(hookGates).toContain(gate);
    }
  });

  it("run the same gates", () => {
    expect([...jobGates].sort()).toEqual([...hookGates].sort());
  });

  it(
    "run each workspace's suite once between them",
    () => {
      const split = windowsJobs
        .map(script => testFiltersIn(script))
        .filter(filters => filters !== null);
      // More than one job, or this would compare an unfiltered run with itself.
      expect(split.length).toBeGreaterThan(1);
      const everySuite = suitesRun([]).sort();
      expect(everySuite.length).toBeGreaterThan(0);
      // `everySuite` names each workspace once, so equality rules out both a
      // suite no job runs and one two jobs run.
      expect(split.flatMap(filters => suitesRun(filters)).sort()).toEqual(
        everySuite
      );
    },
    PLAN_TIMEOUT_MS
  );

  it("reads a job's filters as turbo receives them", () => {
    expect(
      testFiltersIn(
        "pnpm turbo test --continue --filter='!nextly' --filter=@nextlyhq/admin -- --maxWorkers=2"
      )
    ).toEqual(["!nextly", "@nextlyhq/admin"]);
    expect(
      testFiltersIn("pnpm turbo test --continue -- --maxWorkers=2")
    ).toEqual([]);
    expect(
      testFiltersIn("pnpm turbo lint --continue --filter=./packages/*")
    ).toBeNull();
  });

  it("name a gate by what it runs, not by its options", () => {
    expect(
      gatesIn(
        [
          "pnpm lint:design",
          "pnpm run build",
          "pnpm turbo lint --continue \\",
          "  pnpm turbo test --continue $GATE_FILTERS -- --maxWorkers=2",
          "  if ! TURBO_SCM_BASE=origin/main pnpm turbo check-types --affected; then",
          "pnpm install --frozen-lockfile",
          "# pnpm lint:not-a-gate is a comment",
        ].join("\n")
      )
    ).toEqual(
      new Set([
        "lint:design",
        "build",
        "turbo lint",
        "turbo test",
        "turbo check-types",
      ])
    );
  });
});
