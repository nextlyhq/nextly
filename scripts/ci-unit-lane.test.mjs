/**
 * The parts of a CI unit lane's selection that decide what runs and what a
 * shadow run reports: which packages a change reaches, when restored records
 * are trusted, and which failures the selection would have missed.
 */
import { describe, expect, it } from "vitest";

import { affectedPackages, failuresSince, missesOf, recordsDriftReason, shadowLine } from "./ci-unit-lane.mjs";

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
