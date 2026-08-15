import { expect, test } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { flakySummary, recordsFlaky, repoRelative } from "../flaky-reporter";

const ONE = [
  {
    title: "point 1: the innermost container owns the drop target",
    file: "tests/canvas/checklist.spec.ts",
    attempts: 2,
  },
];

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

test("writes NOTHING when no test was flaky", () => {
  // A reassurance printed on every green run is output people stop reading, so
  // the summary stays empty rather than saying "no flaky tests".
  expect(flakySummary([])).toBe("");
});

test("makes a path relative to the REPOSITORY root, not the caller's cwd", () => {
  // CI runs the filtered `@nextlyhq/e2e` script, so `process.cwd()` is `e2e`
  // and stripping it would yield `tests/...` — a path that does not resolve
  // from the root. Derived from this module's own location instead, which does
  // not vary by how the suite was started.
  //
  // Built from `import.meta.url` rather than a literal, so this holds wherever
  // the repository is checked out.
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  expect(repoRelative(`${root}/e2e/tests/canvas/checklist.spec.ts`)).toBe(
    "e2e/tests/canvas/checklist.spec.ts"
  );
  // An unrelated absolute path comes back untouched rather than mangled.
  expect(repoRelative("/somewhere/else/x.spec.ts")).toBe(
    "/somewhere/else/x.spec.ts"
  );
});
