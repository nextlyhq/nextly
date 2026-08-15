import { expect, test } from "@playwright/test";

import {
  flakyAnnotations,
  flakySummary,
  recordsFlaky,
} from "../flaky-reporter";

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

test("escapes a newline in a summary cell instead of splitting the row", () => {
  // The annotation encoder was fixed first, and this is the SAME defect one
  // layer over: a cell cannot contain a real line break, so a legal
  // `test("a\nb")` splits the row and truncates the record before its file and
  // attempt count are read.
  const summary = flakySummary([
    {
      title: "outer › a\nb",
      file: "tests/canvas/checklist.spec.ts",
      attempts: 2,
    },
  ]);
  const row = summary.split("\n").find(l => l.startsWith("| `"));
  expect(row).toBeDefined();
  expect(row).toContain("<br>");
  expect(row).toContain("checklist.spec.ts");
  expect(row).toContain("| 2 |");
});

test("escapes a pipe in a summary cell instead of inventing a column", () => {
  // `|` delimits cells, so an unescaped one in a title adds a column and shifts
  // the file and attempt count into the wrong ones.
  const summary = flakySummary([
    { title: "a | b", file: "f.spec.ts", attempts: 2 },
  ]);
  // Selected by table syntax, not by content: the summary's prose mentions the
  // same words, and matching those found a sentence rather than the row.
  const row = summary.split("\n").find(l => l.startsWith("| `"));
  expect(row).toBeDefined();
  expect(row).toContain("a \\| b");
  // Split on UNESCAPED pipes only. A naive `split("|")` counts the escaped one
  // too, so it measures characters rather than Markdown columns and would
  // report the escaping as having failed when it worked.
  expect(row?.split(/(?<!\\)\|/).length).toBe(5);
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

test("records only the retry that actually PASSED", () => {
  // The classification alone is not enough. A `test.fail()` that unexpectedly
  // passes on attempt 1 and returns to its expected failure on the retry is
  // also classified `flaky`, and this suite carries several expected failures —
  // so reporting on the classification would name a test that ended RED as
  // having passed only on retry.
  expect(recordsFlaky("flaky", "passed", 1)).toBe(true);
  expect(recordsFlaky("flaky", "failed", 1)).toBe(false);
});

test("records a flaky test ONCE, on the attempt that decided it", () => {
  // `onTestEnd` fires per attempt, so the first attempt is seen too. Keying on
  // the classification alone would report the same test twice.
  expect(recordsFlaky("flaky", "passed", 0)).toBe(false);
});

test("ignores a test that simply passed, or simply failed", () => {
  // The negative control: a first-attempt pass is the ordinary case and must
  // stay silent, or the reporter names every green test in the suite.
  expect(recordsFlaky("expected", "passed", 0)).toBe(false);
  expect(recordsFlaky("unexpected", "failed", 1)).toBe(false);
});
