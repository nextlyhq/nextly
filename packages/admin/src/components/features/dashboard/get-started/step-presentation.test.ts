/**
 * The card's rows are the server's steps in the server's order, with runs of
 * Single steps gathered so they can fold: no step is left out for its kind.
 */
import type { GetStartedStep, GetStartedStepKind } from "nextly/config";
import { describe, expect, it } from "vitest";

import { stepRuns } from "./step-presentation";

const step = (key: string, kind: string): GetStartedStep => ({
  key,
  // A kind the server may add later, which no list here names.
  kind: kind as GetStartedStepKind,
  status: "open",
});

describe("the runs a Get started card draws", () => {
  it("keeps the server's order and gathers consecutive Singles into one run", () => {
    const runs = stepRuns([
      step("collection", "collection"),
      step("entry", "entry"),
      step("single:a", "single"),
      step("single:b", "single"),
      step("invite", "invite"),
    ]);
    expect(runs.map(run => [run.kind, run.steps.map(s => s.key)])).toEqual([
      ["steps", ["collection", "entry"]],
      ["singles", ["single:a", "single:b"]],
      ["steps", ["invite"]],
    ]);
  });

  it("draws a step of a kind it does not know, where the server put it", () => {
    // 🔴 Filtered by known kinds, such a step was counted in "x of y" and
    // never drawn.
    const runs = stepRuns([
      step("collection", "collection"),
      step("future", "connect-a-domain"),
      step("invite", "invite"),
    ]);
    expect(runs.flatMap(run => run.steps.map(s => s.key))).toEqual([
      "collection",
      "future",
      "invite",
    ]);
  });
});
