import { expect, test } from "@playwright/test";

import { flakyAnnotations, flakySummary } from "../flaky-reporter";

const ONE = [
  {
    title: "point 1: the innermost container owns the drop target",
    file: "tests/canvas/checklist.spec.ts",
    attempts: 2,
  },
];

test("annotates a flaky test as a WARNING, not an error", () => {
  // An error annotation reads as a failure in the PR UI, and this outcome
  // passed. Reporting it as one would make the build look broken and teach
  // people to ignore the annotation.
  const [line] = flakyAnnotations(ONE);
  expect(line).toContain("::warning ");
  expect(line).not.toContain("::error");
});

test("keeps each annotation on ONE line", () => {
  // A workflow command is terminated by a newline, so a raw newline inside the
  // message splits one annotation into a command plus a stray line of output —
  // the message silently loses everything after the break. This is the whole
  // reason the text is composed rather than templated across lines.
  for (const line of flakyAnnotations(ONE)) {
    expect(line.split("\n")).toHaveLength(1);
  }
});

test("names the file so the annotation lands on it", () => {
  const [line] = flakyAnnotations(ONE);
  expect(line).toContain("file=tests/canvas/checklist.spec.ts");
});

test("reports the attempt count that makes it flaky", () => {
  // A test that passed on attempt 2 is the case; asserting the count separates
  // this from a report that fires on any test at all.
  expect(flakyAnnotations(ONE)[0]).toContain("2 attempts");
});

test("writes NOTHING when no test was flaky", () => {
  // Both halves. A reassurance printed on every green run is output people
  // stop reading, and an empty annotation list keeps the log honest.
  expect(flakyAnnotations([])).toEqual([]);
  expect(flakySummary([])).toBe("");
});

test("summarises every flaky test, not just the first", () => {
  // The reporter's job is the POPULATION. A summary that named one while the
  // run had several would understate exactly what it exists to reveal.
  const two = [
    ...ONE,
    {
      title: "scenario 4b: a 2px jitter at a zone edge",
      file: "tests/canvas/scenarios.spec.ts",
      attempts: 2,
    },
  ];
  const summary = flakySummary(two);
  expect(summary).toContain("2 test(s) passed only on retry");
  expect(summary).toContain("checklist.spec.ts");
  expect(summary).toContain("scenarios.spec.ts");
});
