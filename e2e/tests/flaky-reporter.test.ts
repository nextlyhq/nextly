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

test("escapes a newline in the title instead of ending the command", () => {
  // The case the previous fixture could not reach: it had no newline, so the
  // one-line assertion held by construction and would have kept holding with
  // no escaping at all. A title CAN contain one — `test("a\nb")` is legal —
  // and an unescaped one terminates the workflow command, dropping the rest of
  // the annotation silently.
  const [line] = flakyAnnotations([
    {
      title: "outer › a\nb",
      file: "tests/canvas/checklist.spec.ts",
      attempts: 2,
    },
  ]);
  expect(line.split("\n")).toHaveLength(1);
  expect(line).toContain("%0A");
  expect(line).not.toContain("a\nb");
});

test("escapes % BEFORE the sequences it would corrupt", () => {
  // `%` has to go first: replacing newlines first and percent second would
  // rewrite the `%` of `%0A` into `%25` and produce `%250A`, which renders as
  // the literal text rather than a line break.
  const [line] = flakyAnnotations([
    { title: "100%\ndone", file: "f.spec.ts", attempts: 2 },
  ]);
  expect(line).toContain("100%25%0Adone");
  expect(line).not.toContain("%250A");
});

test("escapes a comma in the path, which would end the property", () => {
  // `,` separates command properties, so an unescaped one in a filename makes
  // GitHub read the remainder as another property and anchor the annotation to
  // a truncated path.
  const [line] = flakyAnnotations([
    { title: "t", file: "tests/a,b.spec.ts", attempts: 2 },
  ]);
  expect(line).toContain("file=tests/a%2Cb.spec.ts");
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
