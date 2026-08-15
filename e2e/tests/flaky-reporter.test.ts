import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import FlakyReporter, {
  flakySummary,
  recordsFlaky,
  repoRelative,
  type ObservedTestCase,
  type ObservedTestResult,
} from "../flaky-reporter";

/** One attempt as the reporter sees it, with only the members it reads. */
function attempt(
  outcome: ReturnType<ObservedTestCase["outcome"]>,
  status: ObservedTestResult["status"],
  retry: number,
  title = "the innermost container owns the drop target"
): [ObservedTestCase, ObservedTestResult] {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  return [
    {
      outcome: () => outcome,
      // Playwright's first entry is the project name, which the reporter drops.
      titlePath: () => ["chromium", "canvas", title],
      location: {
        file: join(root, "e2e/tests/canvas/checklist.spec.ts"),
        line: 1,
        column: 1,
      },
    },
    { status, retry },
  ];
}

/**
 * Runs the reporter over `attempts` with a throwaway step-summary file, and
 * returns what it wrote to each destination.
 */
function runReporter(
  attempts: readonly [ObservedTestCase, ObservedTestResult][]
): {
  summary: string;
  stdout: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "nextly-flaky-"));
  const summaryPath = join(dir, "step-summary.md");
  const previousSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  try {
    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    // The count is written to the real stdout, so reading it back means
    // standing in for the stream the reporter chose rather than asking the
    // reporter to write somewhere a test can see.
    const capture: typeof process.stdout.write = chunk => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };
    process.stdout.write = capture;
    const reporter = new FlakyReporter();
    for (const [testCase, result] of attempts)
      reporter.onTestEnd(testCase, result);
    reporter.onEnd({ status: "passed", startTime: new Date(0), duration: 0 });
  } finally {
    process.stdout.write = originalWrite;
    if (previousSummaryPath === undefined)
      delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = previousSummaryPath;
  }
  let summary = "";
  try {
    summary = readFileSync(summaryPath, "utf8");
  } catch {
    // Absent is a result: the reporter writes nothing when nothing was flaky.
  }
  rmSync(dir, { recursive: true, force: true });
  return { summary, stdout };
}

const ONE = [
  {
    title: "point 1: the innermost container owns the drop target",
    file: "tests/canvas/checklist.spec.ts",
    attempts: 2,
  },
];

test("escapes a newline in a summary cell instead of splitting the row", () => {
  // A Markdown table row is terminated by a line break, so a title containing
  // one splits the row and truncates the record before its file and attempt
  // count are read. `test("a\nb")` is legal, so this is reachable input rather
  // than a defensive case.
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

test("carries a failed-then-passed test through to the summary and the count", () => {
  // The end-to-end control. Every test above calls a helper directly, so all of
  // them stay green if the reporter stops calling those helpers: with no case
  // that drives `onTestEnd` and `onEnd`, removing the callbacks, the record it
  // pushes, or the file write is invisible.
  const { summary, stdout } = runReporter([
    attempt("flaky", "failed", 0),
    attempt("flaky", "passed", 1),
  ]);
  expect(summary).toContain("1 test(s) passed only on retry");
  expect(summary).toContain("the innermost container owns the drop target");
  // Repository-relative, so the path resolves for a reader of the summary.
  expect(summary).toContain("e2e/tests/canvas/checklist.spec.ts");
  // The project name is dropped and the remaining path is joined.
  expect(summary).toContain("canvas › the innermost container");
  // Attempt 2, from a zero-based retry of 1 — and one row, not one per attempt.
  expect(summary).toContain("| 2 |");
  expect(summary.split("\n").filter(l => l.startsWith("| `"))).toHaveLength(1);
  expect(stdout).toContain("flaky-count=1\n");
});

test("leaves the terminal reporter to Playwright", () => {
  // Playwright prepends `dot` (CI) or `line` (local) only while no configured
  // reporter claims the terminal, and it reads a MISSING `printsToStdio` as a
  // claim. Dropping this method therefore removes the run's per-test terminal
  // output — a change with no failing test anywhere else in the suite, since
  // the tests themselves still pass either way.
  expect(new FlakyReporter().printsToStdio()).toBe(false);
});

test("stays silent end to end when every test passed first time", () => {
  // The negative control for the same path: a reporter that recorded every
  // result would still satisfy the test above.
  const { summary, stdout } = runReporter([attempt("expected", "passed", 0)]);
  expect(summary).toBe("");
  expect(stdout).toBe("");
});
