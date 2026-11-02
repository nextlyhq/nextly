/**
 * The parts of a CI unit lane's selection that decide what runs and what a
 * shadow run reports: which packages a change reaches, when restored records
 * are trusted, and which failures the selection would have missed.
 */
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  affectedPackages,
  failuresSince,
  laneTurboFlags,
  MEASURED_FOR_SELECTION,
  missesOf,
  planWorkspaces,
  recordsDriftReason,
  shadowLine,
} from "./ci-unit-lane.mjs";
import { pnpmWorkspaces, workspacesFrom } from "./gate-scope.mjs";

describe("affectedPackages", () => {
  // admin -> ui -> tokens; builder -> ui; docs depends on nothing. Listed with
  // dependents BEFORE what they depend on, as workspace order may be, so one
  // pass in this order reaches ui but not admin or builder.
  const dependenciesOf = new Map([
    ["admin", ["ui"]],
    ["builder", ["ui"]],
    ["ui", ["tokens"]],
    ["tokens", []],
    ["docs", []],
  ]);

  it("reaches a package through every package in between, not only its direct dependents", () => {
    expect([...affectedPackages(["tokens"], dependenciesOf)].sort()).toEqual(["admin", "builder", "tokens", "ui"]);
  });

  it("leaves out packages the change cannot reach", () => {
    expect([...affectedPackages(["ui"], dependenciesOf)].sort()).toEqual(["admin", "builder", "ui"]);
  });
});

describe("recordsDriftReason", () => {
  it("trusts records whose commit matches main as tested for the package", () => {
    expect(recordsDriftReason([])).toBeNull();
  });

  it("runs in full when a file differs either way, naming it", () => {
    expect(recordsDriftReason(["packages/ui/src/a.ts"])).toContain("packages/ui/src/a.ts");
  });

  it("runs in full when no restored record says which commit it describes", () => {
    expect(recordsDriftReason(null)).not.toBeNull();
  });
});

describe("laneTurboFlags", () => {
  it("keeps a lane's own turbo flags and drops its filters", () => {
    const script = "turbo run test --concurrency=50% --filter='./packages/*' --filter='!nextly' --filter='!@nextlyhq/admin'";
    expect(laneTurboFlags(script)).toEqual(["--concurrency=50%"]);
  });

  it("is empty for a lane that passes none", () => {
    expect(laneTurboFlags("turbo run test --filter=nextly")).toEqual([]);
  });
});

describe("shadowLine", () => {
  it("prints a selection with its total, and a full run with its reason", () => {
    expect(shadowLine("ui", { full: false, files: ["a.test.ts", "b.test.ts"] }, 40)).toBe("selection-shadow: ui selected=2 total=40");
    expect(shadowLine("ui", { full: true, reason: "pnpm-lock.yaml changed" })).toBe("selection-shadow: ui full=pnpm-lock.yaml changed");
  });
});

describe("failuresSince", () => {
  const results = {
    version: 1,
    projects: {
      unit: {
        files: {
          "src/new-fail.test.ts": { failed: true, lastRun: 2000 },
          "src/new-pass.test.ts": { failed: false, lastRun: 2000 },
          "src/old-fail.test.ts": { failed: true, lastRun: 500 },
        },
      },
    },
  };

  it("counts only files that ran in this job, so a failure restored from an earlier run is not one", () => {
    expect(failuresSince([results], 1000)).toEqual({ ran: 2, failed: ["src/new-fail.test.ts"] });
  });

  it("says nothing ran when every result predates the job, rather than reporting no failures", () => {
    expect(failuresSince([results], 3000)).toEqual({ ran: 0, failed: [] });
  });
});

describe("missesOf", () => {
  it("names a failed file the selection left out, and not one it ran", () => {
    expect(missesOf({ full: false, files: ["a.test.ts"] }, ["a.test.ts", "b.test.ts"])).toEqual(["b.test.ts"]);
  });

  it("finds none for a package planned in full", () => {
    expect(missesOf({ full: true, reason: "x" }, ["a.test.ts"])).toEqual([]);
  });
});

describe("planWorkspaces", () => {
  const selection = { full: false, files: ["src/a.test.ts"] };
  const measured = { name: "nextly", dir: "packages/nextly" };
  const unmeasured = { name: "create-nextly-app", dir: "packages/create-nextly-app" };
  const plan = (workspaces, select) =>
    planWorkspaces(workspaces, { select, planOf: () => selection, totalOf: () => 40 });

  it("runs a package not measured for selection in full when selecting, and keeps a measured one's selection", () => {
    expect(plan([measured, unmeasured], true)).toEqual([
      { name: "nextly", dir: "packages/nextly", plan: selection, total: 40 },
      {
        name: "create-nextly-app",
        dir: "packages/create-nextly-app",
        plan: { full: true, reason: "not yet measured for selection" },
        total: null,
      },
    ]);
  });

  it("still reports what selection would run for an unmeasured package when only planning", () => {
    expect(plan([unmeasured], false)).toEqual([
      { name: "create-nextly-app", dir: "packages/create-nextly-app", plan: selection, total: 40 },
    ]);
  });

  it("runs a package added later in full until it is measured", () => {
    const added = { name: "@nextlyhq/a-package-added-later", dir: "packages/a-package-added-later" };
    expect(plan([added], true)[0].plan).toEqual({ full: true, reason: "not yet measured for selection" });
  });
});

describe("MEASURED_FOR_SELECTION", () => {
  // The same workspace list the lanes are planned from, so a misspelt or
  // renamed package here is one no lane could ever select for.
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const names = new Set(workspacesFrom(pnpmWorkspaces(root), root).map(workspace => workspace.name));

  it("names only packages the workspace has", () => {
    // A workspace that always has `nextly` shows the list was read at all.
    expect(names.has("nextly")).toBe(true);
    expect([...MEASURED_FOR_SELECTION].filter(name => !names.has(name))).toEqual([]);
  });
});
