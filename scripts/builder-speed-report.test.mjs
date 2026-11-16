/**
 * The builder speed check's report (`e2e/builder-speed/report.mjs`): a miss
 * fails the run and names the measure, its result and its budget; a known
 * miss does not; and a known miss that starts passing fails the run, so its
 * mark is removed and the gain is kept.
 *
 * Here rather than under `e2e/`, where every `*.test.*` file is taken as a
 * browser spec: the report is plain Node, as the checks beside this file are.
 */
import { describe, expect, it } from "vitest";

import { BUDGETS } from "../e2e/builder-speed/budgets.mjs";
import { EXPECTED_FAILURES } from "../e2e/builder-speed/expected-failures.mjs";
import {
  aggregateOf,
  judge,
  percentile,
  table,
} from "../e2e/builder-speed/report.mjs";

/** Two budgets, enough to tell one row's outcome from another's. */
const TWO = [
  {
    id: "undo",
    label: "Undo",
    budget: 200,
    unit: "ms",
    aggregate: "p75",
  },
  {
    id: "select-requests",
    label: "Server requests per selection",
    budget: 0,
    unit: "requests",
    aggregate: "max",
  },
];

const ten = value => Array.from({ length: 10 }, () => value);

describe("the builder speed report", () => {
  it("fails a missed budget, naming the measure, its result and its budget", () => {
    const { rows, problems } = judge(
      { undo: { samples: ten(350) }, "select-requests": { samples: ten(0) } },
      TWO,
      {}
    );
    expect(rows.map(row => row.outcome)).toEqual(["fail", "pass"]);
    expect(problems).toEqual(["Undo: 350 ms, budget 200 ms"]);
  });

  it("fails the run when a budget is tightened below the result, as a broken budget would", () => {
    // The check's own control: the real "Undo" budget set to 1 ms fails a
    // result the real budget passes.
    const tight = BUDGETS.map(budget =>
      budget.id === "undo" ? { ...budget, budget: 1 } : budget
    );
    const undo = { samples: ten(50) };
    expect(judge({ undo }, BUDGETS, {}, { only: ["undo"] }).problems).toEqual(
      []
    );
    expect(judge({ undo }, tight, {}, { only: ["undo"] }).problems).toEqual([
      "Undo: 50 ms, budget 1 ms",
    ]);
  });

  it("passes a known miss, and says it is one", () => {
    const { rows, problems } = judge(
      { undo: { samples: ten(900) }, "select-requests": { samples: ten(0) } },
      TWO,
      { undo: "a whole-page check runs behind every undo" }
    );
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({
      outcome: "expected",
      result: 900,
      mark: "a whole-page check runs behind every undo",
    });
    expect(table(rows)).toContain("known miss");
  });

  it("fails a known miss that now passes, so its mark is removed", () => {
    const { rows, problems } = judge(
      { undo: { samples: ten(120) }, "select-requests": { samples: ten(0) } },
      TWO,
      { undo: "a whole-page check runs behind every undo" }
    );
    expect(rows[0]?.outcome).toBe("unexpected-pass");
    expect(problems).toEqual([
      "Undo: 120 ms, budget 200 ms. It passes, but is marked as a known miss: remove its line from expected-failures.mjs",
    ]);
  });

  it("fails a measure that was not taken, or never showed, rather than passing it", () => {
    const { problems } = judge(
      {
        undo: { samples: [80, null, 90], note: "not shown within 60 s" },
      },
      TWO,
      {}
    );
    expect(problems).toEqual([
      "Undo: not shown within 60 s, budget 200 ms",
      "Server requests per selection: not measured, budget 0 requests",
    ]);
  });

  it("fails a known miss that could not be measured, rather than excusing it", () => {
    const { rows, problems } = judge(
      {
        undo: {
          samples: [null],
          note: "could not be measured: no Undo button",
        },
        "select-requests": { samples: ten(0) },
      },
      TWO,
      { undo: "a whole-page check runs behind every undo" }
    );
    expect(rows[0]?.outcome).toBe("fail");
    expect(problems).toEqual([
      "Undo: could not be measured: no Undo button, budget 200 ms",
    ]);
  });

  it("leaves out the measures a run was told to skip", () => {
    const { rows, problems } = judge(
      { undo: { samples: ten(100) } },
      TWO,
      {},
      { only: ["undo"] }
    );
    expect(rows.map(row => row.outcome)).toEqual(["pass", "skipped"]);
    expect(problems).toEqual([]);
  });

  it("fails a mark for a measure no budget names", () => {
    const { problems } = judge(
      { undo: { samples: ten(100) }, "select-requests": { samples: ten(0) } },
      TWO,
      { "renamed-measure": "a stale reason" }
    );
    expect(problems).toEqual([
      'expected-failures.mjs marks "renamed-measure", which no budget names: remove the line',
    ]);
  });

  it("reads the 75th percentile by nearest rank, and the most for a count", () => {
    const samples = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(percentile(samples, 75)).toBe(8);
    expect(aggregateOf("p75", samples)).toBe(8);
    expect(aggregateOf("max", [0, 0, 3, 0])).toBe(3);
    expect(aggregateOf("single", [42])).toBe(42);
    expect(aggregateOf("p75", [])).toBeNull();
  });
});

describe("the builder speed budgets and marks", () => {
  it("names each budget once", () => {
    const ids = BUDGETS.map(budget => budget.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks only measures a budget names, each with a reason", () => {
    const ids = new Set(BUDGETS.map(budget => budget.id));
    for (const [id, reason] of Object.entries(EXPECTED_FAILURES)) {
      expect(ids.has(id), id).toBe(true);
      // A reason someone can act on: how far off, and what causes it.
      expect(reason.length, id).toBeGreaterThan(30);
    }
  });
});
