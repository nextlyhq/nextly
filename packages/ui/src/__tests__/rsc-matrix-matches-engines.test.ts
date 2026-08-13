/**
 * The derivation behind the RSC job's Node legs, and the workflow's use of it.
 *
 * Two separate claims, and only the first is about behaviour. `matrixFor` decides which versions a
 * supported range asks to be tested; the workflow has to actually CONSUME that rather than carry a
 * list beside it. A correct derivation nothing reads is the same as no derivation.
 *
 * The released majors are passed IN here rather than fetched. A unit suite that reaches the network
 * fails when the network does, and reports it as a defect in this package.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { lowestFloor, matrixFor } from "../../scripts/node-matrix.js";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

const engines: string = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8")
).engines.node;

const workflow = readFileSync(
  path.join(repoRoot, ".github", "workflows", "package-smoke.yml"),
  "utf8"
);

describe("deriving the Node legs from a supported range", () => {
  it("tests the exact floor of a closed clause", () => {
    // The floor is where a global Node added later is ABSENT, which is the whole signal. A major
    // selector would install the newest of that line and never reach it.
    expect(matrixFor("^20.19.0 || ^22.12.0", [20, 22])).toEqual([
      "20.19.0",
      "22.12.0",
    ]);
  });

  it("tests every released major above an open clause, not just its endpoints", () => {
    // `>=24.0.0` promises 24, 25 and 26 alike. The floor plus the newest release leaves 25
    // unexercised, and a regression confined to it reaches consumers with every leg green.
    //
    // Each is named by its own FLOOR. A bare `25` is a selector `setup-node` resolves to the
    // newest 25.x, which is not the version the range promises — the same mistake the closed
    // clauses avoid, and the gap is where an API added after 25.0.0 lives.
    expect(matrixFor(">=24.0.0", [22, 24, 25, 26])).toEqual([
      "24.0.0",
      "25.0.0",
      "26.0.0",
    ]);
  });

  it("picks up a new major without an edit here", () => {
    // The property that makes this worth deriving at all.
    expect(matrixFor(">=24.0.0", [24, 25, 26, 27])).toContain("27.0.0");
  });

  it("names no major that has not been released", () => {
    // The mirror: a range admits versions that do not exist, and asking CI to install one fails the
    // job for a reason that is not about this package.
    expect(matrixFor(">=24.0.0", [24])).toEqual(["24.0.0"]);
  });

  it("refuses a clause it cannot read rather than returning a shorter list", () => {
    // Skipping is the quieter failure: the job keeps passing on the clauses that were understood.
    expect(() => matrixFor("20.x", [20])).toThrow(
      /neither a caret nor a >= range/
    );
  });

  it("selects the lowest floor for a pull request", () => {
    expect(lowestFloor("^20.19.0 || ^22.12.0 || >=24.0.0")).toBe("20.19.0");
  });

  it("selects the lowest floor however the clauses are ordered", () => {
    // A semver union has no required order, so this states the same contract as the ascending
    // spelling above. Reading the first clause would run Node 24 on every pull request while the
    // real floor went unexercised — and every synchronisation check here would still be green,
    // because they compare the matrix to the range rather than to what the range MEANS.
    expect(lowestFloor(">=24.0.0 || ^20.19.0")).toBe("20.19.0");
    expect(lowestFloor("^22.12.0 || ^20.19.0")).toBe("20.19.0");
    // Ordering is numeric, not lexicographic: "9.0.0" must not beat "10.0.0" by string compare.
    expect(lowestFloor("^10.0.0 || ^9.0.0")).toBe("9.0.0");
    expect(lowestFloor("^20.9.0 || ^20.19.0")).toBe("20.9.0");
  });

  it("reads this repository's own range without throwing", () => {
    // The control that keeps the cases above from being a private grammar: the range this repo
    // actually declares has to be one the parser accepts.
    expect(matrixFor(engines, [20, 22, 24]).length).toBeGreaterThan(0);
  });
});

describe("the workflow's use of that derivation", () => {
  it("takes its matrix from the derivation job, not from a list", () => {
    const line = workflow
      .split("\n")
      .find(text => text.trimStart().startsWith("node: ${{"));
    expect(
      line,
      "the RSC job's matrix expression was not found, so this test would assert nothing"
    ).toBeDefined();
    // A literal array here is the drift this whole module exists to remove, so it is named as the
    // failure rather than left to a mismatch further down.
    expect(
      line,
      "the matrix names versions inline; it must read them from the node-matrix job"
    ).not.toMatch(/\[\s*"\d/);
    // Both names OCCURRING is not the property. Swapping them leaves every assertion above green
    // while scheduled runs exercise only the lowest floor and pull requests run the full matrix —
    // a plausible broken form the test could not tell from the intended one.
    //
    // The expression is `cond && A || B`, so the operand AFTER the `&&` is what a pull request
    // selects and the one after the `||` is what everything else does.
    // The whole condition, not just its tail. Matching only `pull_request' &&` accepts
    // `github.event_name != 'pull_request'`, which reverses the two matrices while satisfying
    // every assertion here — the plausible broken form this test exists to exclude.
    // Anchored to the WHOLE `${{ … }}` expression. A prefix match accepts a trailing
    // `&& fromJSON('["unexpected"]')`, which satisfies every assertion here while selecting a
    // third matrix — the same class as the operand swap and the inverted condition below it.
    const chosen =
      /^\s*node:\s*\$\{\{\s*fromJSON\(\s*github\.event_name\s*==\s*'pull_request'\s*&&\s*([^|]+?)\s*\|\|\s*([^)]+?)\s*\)\s*\}\}\s*$/.exec(
        line as string
      );
    expect(
      chosen,
      "the matrix expression is not the expected `event == pull_request && A || B` form"
    ).not.toBeNull();
    const [, onPullRequest, otherwise] = chosen as RegExpExecArray;
    expect(
      onPullRequest,
      "a pull request must run the single lowest floor"
    ).toBe("needs.node-matrix.outputs.lowest");
    expect(
      otherwise,
      "a scheduled or dispatched run must run the full derived matrix"
    ).toBe("needs.node-matrix.outputs.versions");
  });

  it("declares the dependency that makes those outputs available", () => {
    // `needs` is what populates `needs.node-matrix.outputs`; without it the expression resolves to
    // empty and the matrix silently produces no legs at all.
    expect(workflow).toMatch(/\n {4}needs: node-matrix\n/);
  });
});
