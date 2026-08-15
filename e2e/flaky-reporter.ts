/**
 * Records tests that only passed on a RETRY, so the set is countable over time.
 *
 * **This deliberately does NOT annotate.** Playwright's own `github` reporter
 * already emits `::error` for the failed attempt and a `::notice` naming the
 * flaky spec, and the run still exits 0 — measured on 1.61.1 with a test that
 * fails once and then passes. A second annotation for the same event, at a
 * different severity, is harder to read than one.
 *
 * What it adds is the part no reporter covers: a job-summary section and a
 * machine-readable line, so "which specs only pass on retry" is answerable
 * across runs rather than by reading one log. That question has no answer from
 * run metadata — the retry is Playwright's own, so `run_attempt` stays 1 and
 * nothing at the workflow level distinguishes a retried pass from a clean one.
 *
 * @module flaky-reporter
 */
import { appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

/** A test that failed at least once and then passed. */
export interface FlakyTest {
  title: string;
  file: string;
  attempts: number;
}

/**
 * The parts of Playwright's own types this reporter reads.
 *
 * Narrowed rather than taken whole so that the reporter states its inputs, and
 * so a caller can supply them: `TestCase` and `TestResult` carry back-references
 * to the whole suite and cannot be constructed outside a run.
 * `onTestEnd` still satisfies `Reporter` — a full `TestCase` is assignable to
 * this, and method parameters are compared bivariantly.
 */
export interface ObservedSuite {
  title: string;
  type: Suite["type"];
  parent?: ObservedSuite;
}
export type ObservedTestCase = Pick<
  TestCase,
  "outcome" | "title" | "location"
> & { parent?: ObservedSuite };
export type ObservedTestResult = Pick<TestResult, "status" | "retry">;

/**
 * A test's enclosing `describe` titles, outermost first.
 *
 * Selected by suite TYPE rather than by position. `titlePath()` returns the
 * whole hierarchy — `["", project, file, ...describes, title]` — so dropping
 * the metadata by index means hardcoding how many entries Playwright happens to
 * put in front, and the file is already its own column. The type is the thing
 * that decides: `root`, `project` and `file` are all suites, and only `describe`
 * is authored.
 */
function describePath(test: ObservedTestCase): string[] {
  const titles: string[] = [];
  for (let suite = test.parent; suite; suite = suite.parent) {
    if (suite.type === "describe") titles.unshift(suite.title);
  }
  return titles;
}

/**
 * A repository-relative path for an absolute test file.
 *
 * Derived from THIS module's own location rather than from `process.cwd()`,
 * which differs by how the suite was started: CI runs the filtered
 * `@nextlyhq/e2e` script, whose working directory is `e2e`, so stripping the
 * cwd yields `tests/...` — a path that resolves from neither the repository
 * root nor a checkout, leaving the summary's file column unopenable. This file
 * sits in `e2e`, so its own directory's parent is the root wherever the run
 * began.
 */
export function repoRelative(absolute: string): string {
  const root = `${dirname(dirname(fileURLToPath(import.meta.url)))}/`;
  return absolute.startsWith(root) ? absolute.slice(root.length) : absolute;
}

/**
 * A value safe inside a Markdown TABLE CELL.
 *
 * A cell is delimited by `|` and a row by a line break, so either character
 * taken from a test title or a path is read as structure rather than as text:
 * a `|` invents a column and a newline splits the row, truncating the record
 * before its file and attempt count. `\\` first, or it would escape the pipes
 * introduced after it. Line breaks become `<br>` because a cell cannot contain
 * a real one at all.
 */
function escapeTableCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n?|\n/g, "<br>");
}

/**
 * The job-summary table, or an empty string when nothing was flaky.
 *
 * Empty rather than a "no flaky tests" note on purpose: the summary is read to
 * find problems, and a reassurance printed on every green run is the kind of
 * output people stop seeing.
 */
export function flakySummary(tests: readonly FlakyTest[]): string {
  if (tests.length === 0) return "";
  const rows = tests
    .map(
      t =>
        `| \`${escapeTableCell(t.title)}\` | ${escapeTableCell(t.file)} | ${String(t.attempts)} |`
    )
    .join("\n");
  return [
    `### ${String(tests.length)} test(s) passed only on retry`,
    "",
    "These did not fail the build. They are listed because a retried pass and a",
    "first-attempt pass produce the same job conclusion, so nothing else reports them.",
    "",
    "| test | file | attempts |",
    "| --- | --- | --- |",
    rows,
    "",
  ].join("\n");
}

/**
 * Whether this attempt is the one that makes a test worth reporting.
 *
 * Pure, so the rule is testable without constructing Playwright's own types —
 * the classification alone is not sufficient and the reason is easy to lose.
 *
 * A `test.fail()` that unexpectedly PASSES on attempt 1 and returns to its
 * expected failure on the retry is ALSO classified `flaky`, and this suite
 * carries several expected failures. Reporting on the classification alone
 * would name a test that ended red as having "passed only on retry", which is
 * the opposite of true.
 *
 * Requiring the passing retry also yields exactly one record per test:
 * `onTestEnd` fires once per attempt, so keying on the classification would
 * report the same test twice.
 */
export function recordsFlaky(
  outcome: string,
  status: string,
  retry: number
): boolean {
  return outcome === "flaky" && status === "passed" && retry > 0;
}

export default class FlakyReporter implements Reporter {
  private readonly flaky: FlakyTest[] = [];

  /**
   * Playwright adds `dot` (or `line`) only when NO configured reporter claims
   * the terminal, and a reporter that omits this method counts as claiming it.
   * This one writes a single line at the very end and renders no progress, so
   * answering `true` by omission would silently remove the run's only
   * per-test terminal output.
   */
  printsToStdio(): boolean {
    return false;
  }

  onTestEnd(test: ObservedTestCase, result: ObservedTestResult): void {
    // `outcome()` is Playwright's own classification and already accounts for
    // expected failures, so a `test.fail()` that fails and then passes is not
    // reported here as flaky. Recomputing it from `result.status` would be a
    // second implementation of a question Playwright already answers.
    // `outcome()` alone is not enough. A `test.fail()` that unexpectedly PASSES
    // on attempt 1 and returns to its expected failure on the retry is also
    // classified `flaky`, and this suite carries several expected failures — so
    // reporting on the classification alone would name tests that ended red as
    // having "passed only on retry", which is the opposite of true.
    //
    // Requiring the passing retry itself gives one record per flaky test, on
    // the attempt that decided it: `onTestEnd` fires once per attempt, so
    // keying on the classification would also record the same test twice.
    if (!recordsFlaky(test.outcome(), result.status, result.retry)) return;
    this.flaky.push({
      title: [...describePath(test), test.title].join(" › "),
      file: repoRelative(test.location.file),
      // `retry` is zero-based, so the run that finally passed is attempt N+1.
      attempts: result.retry + 1,
    });
  }

  onEnd(_result: FullResult): void {
    if (this.flaky.length === 0) return;
    // One machine-readable line, so a later run can be compared with this one
    // without parsing prose. The `github` reporter already says which spec was
    // flaky; this says HOW MANY, which is the part a trend needs.
    process.stdout.write(`flaky-count=${String(this.flaky.length)}\n`);
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath === undefined || summaryPath === "") return;
    // Appended, never truncated: other steps write their own sections to this
    // same file, and a whole-file write would delete them.
    appendFileSync(summaryPath, flakySummary(this.flaky));
  }
}
