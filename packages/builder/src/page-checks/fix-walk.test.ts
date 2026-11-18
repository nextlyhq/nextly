/**
 * Walking the list while fixing: where the author is, what Previous and Next
 * go to, and what the bar says, as the findings change under each fix.
 */
import { describe, expect, it } from "vitest";

import { fixNeighbour, fixStep, fixStepWords } from "./fix-walk";
import type { PageFinding } from "./page-checks";

function finding(key: string): PageFinding {
  return {
    key,
    check: "probe",
    group: "accessibility",
    nodeId: key,
    what: "Wrong",
    why: "It matters.",
    todo: "Fix it.",
  };
}

const FIVE = ["a", "b", "c", "d", "e"].map(finding);

describe("where the author is", () => {
  it("is at the finding they went to, counted in the list's order", () => {
    const step = fixStep(FIVE, { key: "b", index: 1 });
    expect(step).toMatchObject({ kind: "at", index: 1, total: 5 });
    expect(fixStepWords(step)).toBe("Check 2 of 5");
  });

  it("follows the finding when one before it is fixed", () => {
    const step = fixStep(
      FIVE.filter(each => each.key !== "a"),
      { key: "c", index: 2 }
    );
    expect(fixStepWords(step)).toBe("Check 2 of 4");
  });

  it("says it is fixed, and how many are left, once the finding goes", () => {
    const step = fixStep(
      FIVE.filter(each => each.key !== "b"),
      { key: "b", index: 1 }
    );
    expect(step).toEqual({ kind: "fixed", next: 1, total: 4 });
    expect(fixStepWords(step)).toBe("Fixed · 4 to go");
  });

  it("says one to go in the singular", () => {
    expect(fixStepWords(fixStep([finding("e")], { key: "d", index: 3 }))).toBe(
      "Fixed · 1 to go"
    );
  });

  it("is all clear once nothing is left", () => {
    const step = fixStep([], { key: "e", index: 0 });
    expect(step).toEqual({ kind: "clear" });
    expect(fixStepWords(step)).toBe("All clear");
  });
});

describe("Previous and Next", () => {
  it("go to the findings either side of the one the author is at", () => {
    const step = fixStep(FIVE, { key: "c", index: 2 });
    expect(fixNeighbour(FIVE, step, -1)?.key).toBe("b");
    expect(fixNeighbour(FIVE, step, 1)?.key).toBe("d");
  });

  it("stop at the ends of the list", () => {
    expect(fixNeighbour(FIVE, fixStep(FIVE, { key: "a", index: 0 }), -1)).toBe(
      undefined
    );
    expect(fixNeighbour(FIVE, fixStep(FIVE, { key: "e", index: 4 }), 1)).toBe(
      undefined
    );
  });

  it("go on from where a fixed finding was: Next to the one now in its place", () => {
    const left = FIVE.filter(each => each.key !== "c");
    const step = fixStep(left, { key: "c", index: 2 });
    expect(fixNeighbour(left, step, 1)?.key).toBe("d");
    expect(fixNeighbour(left, step, -1)?.key).toBe("b");
  });

  it("offer only Previous once the last finding is fixed", () => {
    const left = FIVE.filter(each => each.key !== "e");
    const step = fixStep(left, { key: "e", index: 4 });
    expect(fixNeighbour(left, step, 1)).toBe(undefined);
    expect(fixNeighbour(left, step, -1)?.key).toBe("d");
  });

  it("go nowhere once all is clear", () => {
    const step = fixStep([], { key: "a", index: 0 });
    expect(fixNeighbour([], step, 1)).toBe(undefined);
    expect(fixNeighbour([], step, -1)).toBe(undefined);
  });
});
