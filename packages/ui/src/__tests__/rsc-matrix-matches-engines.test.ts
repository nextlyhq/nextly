/**
 * The Node versions the RSC smoke job runs against, checked against the range the repo supports.
 *
 * The job's matrix is a list of exact versions and the `engines.node` range is a semver expression,
 * so the two cannot be one value — but they answer one question, and a copy drifts. Widening the
 * range without touching the workflow leaves a newly supported floor untested while every leg stays
 * green, which is the shape a version matrix is least likely to be suspected of.
 *
 * Checked here rather than derived inside the workflow. A setup job computing the matrix would
 * remove the copy entirely, at the cost of an extra job on every run and a second place for the
 * parsing to live; this suite already runs on every pull request, including the ones that change the
 * root manifest, so the drift is caught at the same moment for less.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

/**
 * The exact versions a semver range's clauses START at, plus whether any clause is open-ended.
 *
 * Only the two forms the range actually uses are recognised, and anything else THROWS rather than
 * being skipped. A parser that ignores what it cannot read would return a shorter list, and a
 * shorter list compares unequal and fails — but it would fail naming the wrong cause, sending the
 * next reader to the workflow when the range is what changed shape.
 */
function floorsOf(range: string): { floors: string[]; openEnded: boolean } {
  const floors: string[] = [];
  let openEnded = false;
  for (const clause of range.split("||").map(part => part.trim())) {
    const caret = /^\^(\d+\.\d+\.\d+)$/.exec(clause);
    const atLeast = /^>=(\d+\.\d+\.\d+)$/.exec(clause);
    if (caret !== null) {
      floors.push(caret[1]);
    } else if (atLeast !== null) {
      floors.push(atLeast[1]);
      openEnded = true;
    } else {
      throw new Error(
        `engines.node clause ${JSON.stringify(clause)} is neither a caret nor a >= range, so the ` +
          `versions it admits could not be derived. Teach this parser the new form.`
      );
    }
  }
  return { floors, openEnded };
}

/** The two version lists the matrix expression chooses between, pull-request first. */
function matrixLists(): { onPullRequest: string[]; nightly: string[] } {
  const line = workflow
    .split("\n")
    .find(text => text.includes("fromJSON(github.event_name =="));
  expect(
    line,
    "the RSC job's matrix expression was not found, so this test would assert nothing"
  ).toBeDefined();
  const arrays = [...(line as string).matchAll(/'(\[[^\]]*\])'/g)].map(match =>
    JSON.parse(match[1])
  );
  expect(
    arrays.length,
    `expected two version lists in the matrix expression, found ${arrays.length}`
  ).toBe(2);
  return { onPullRequest: arrays[0], nightly: arrays[1] };
}

describe("the RSC smoke matrix and the engines range", () => {
  it("runs every floor the supported range declares", () => {
    const { floors, openEnded } = floorsOf(engines);
    expect(floors.length, "engines.node named no versions").toBeGreaterThan(0);

    // `latest` stands for the open-ended clause. Every release since that floor is a version the
    // manifest promises, and there is no highest one to enumerate.
    const expected = openEnded ? [...floors, "latest"] : floors;
    expect(matrixLists().nightly).toEqual(expected);
  });

  it("runs the lowest floor on a pull request", () => {
    // One leg per PR, and it has to be the LOWEST: everything the newer lines reject it rejects
    // too, plus the globals they have and it does not.
    const { floors } = floorsOf(engines);
    expect(matrixLists().onPullRequest).toEqual([floors[0]]);
  });

  it("derives the floors from the range rather than restating them", () => {
    // The control on the parser itself. Without it, a `floorsOf` that returned a hard-coded list
    // would satisfy both assertions above for as long as the range happened to match.
    expect(floorsOf("^20.19.0 || ^22.12.0 || >=24.0.0")).toEqual({
      floors: ["20.19.0", "22.12.0", "24.0.0"],
      openEnded: true,
    });
    expect(floorsOf("^18.0.0 || ^20.1.2")).toEqual({
      floors: ["18.0.0", "20.1.2"],
      openEnded: false,
    });
    expect(() => floorsOf("20.x")).toThrow(/neither a caret nor a >= range/);
  });
});
