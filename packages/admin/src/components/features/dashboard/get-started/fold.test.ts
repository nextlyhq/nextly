/**
 * The order the Get started card draws its steps in: those still to do first.
 */
import { describe, expect, it } from "vitest";

import type { GetStartedStep } from "nextly/config";

import { stepsToDoFirst } from "./fold";

const step = (
  key: string,
  status: GetStartedStep["status"]
): GetStartedStep => ({ key, kind: "single", status, single: key });

describe("stepsToDoFirst", () => {
  // The server's order, finished and unfinished mixed as a real install answers them.
  const answered = [
    step("a", "done"),
    step("b", "done"),
    step("c", "open"),
    step("d", "skipped"),
    step("e", "unknown"),
    step("f", "open"),
  ];

  it("puts the steps still to do first and the finished after, each in the server's order", () => {
    expect(stepsToDoFirst(answered).map(s => s.key)).toEqual([
      "c",
      "e",
      "f",
      "a",
      "b",
      "d",
    ]);
  });

  it("never hides a step still to do while a finished one is drawn, however many fit", () => {
    // Every fold the card can make: the first `shown` steps drawn, the rest behind the control.
    const ordered = stepsToDoFirst(answered);
    const finished = (s: GetStartedStep) =>
      s.status === "done" || s.status === "skipped";
    for (let shown = 0; shown <= ordered.length; shown++) {
      const drawn = ordered.slice(0, shown);
      const hidden = ordered.slice(shown);
      if (drawn.some(finished)) {
        expect(
          hidden.filter(s => !finished(s)),
          `${shown} drawn`
        ).toEqual([]);
      }
    }
    // The must-differ case: in the server's own order, two drawn steps hide four still to do.
    const asAnswered = answered.slice(0, 2);
    expect(asAnswered.every(finished)).toBe(true);
    expect(answered.slice(2).some(s => !finished(s))).toBe(true);
  });
});
