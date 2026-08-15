/**
 * Reports tests that only passed on a RETRY, without changing the verdict.
 *
 * `retries: 1` in CI exists for genuinely slow-machine flakes, and it converts
 * a real failure into a job conclusion of `success`. Measured on `origin/main`
 * run 31806221974: `checklist.spec.ts` "[acceptance] point 1" failed on attempt
 * 1 with one occurrence, passed on the retry, and the job reported success.
 *
 * That is a worse shape than the failures `.claude/rules/reading-a-ci-verdict.md`
 * catalogues. Every case there is an ABSENCE — a workflow that never fired, a
 * dependent that skipped — and each announces itself as a gap once you look. A
 * retried pass produces a POSITIVE green with nothing missing to notice, and no
 * query over job conclusions can see it, because `conclusion` is the field the
 * retry overwrote.
 *
 * The retry is Playwright's own rather than a GitHub re-run, so `run_attempt`
 * stays 1 and no run-level metadata reveals it. Only the test result knows.
 *
 * This REPORTS and never blocks: it emits workflow warnings and a job-summary
 * table, and leaves the exit status alone. Whether a flaky pass should fail the
 * build is a policy question; making it visible is not, and today the two
 * outcomes are indistinguishable downstream.
 *
 * @module flaky-reporter
 */
import { appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  FullResult,
  Reporter,
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
 * A workflow command's DATA section, with the characters that would END it.
 *
 * A command is terminated by a real newline, so one inside a test title splits
 * the annotation into a command plus a stray line of output and silently drops
 * everything after the break. GitHub's encoding for this is percent-escapes,
 * and `%` must be replaced FIRST or it would corrupt the escapes introduced
 * after it.
 */
function escapeCommandData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * A command PROPERTY, which needs more escaping than the data section.
 *
 * `,` separates properties and `:` ends the property list, so a value carrying
 * either is read as structure rather than as text — a path containing a comma
 * silently truncates the file the annotation anchors to.
 */
function escapeCommandProperty(value: string): string {
  return escapeCommandData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * A repository-relative path for an absolute test file.
 *
 * Derived from THIS module's own location rather than from `process.cwd()`,
 * which differs by how the suite was started: CI runs the filtered
 * `@nextlyhq/e2e` script, whose working directory is `e2e`, so stripping the
 * cwd yields `tests/...` — a path that does not exist from the repository
 * root, and GitHub anchors the annotation to nothing. This file sits in `e2e`,
 * so its own directory's parent is the root wherever the run began.
 */
function repoRelative(absolute: string): string {
  const root = `${dirname(dirname(fileURLToPath(import.meta.url)))}/`;
  return absolute.startsWith(root) ? absolute.slice(root.length) : absolute;
}

/**
 * The workflow-command lines for a set of flaky tests.
 *
 * Separated from the reporter so the formatting is testable without running a
 * suite. `::warning::` rather than `::error::` deliberately — an error
 * annotation reads as a failure in the PR UI, and this outcome passed.
 *
 * Newlines are encoded as `%0A` because a workflow command is terminated by a
 * real newline: an unencoded one splits a single annotation into a command and
 * a stray line of output, which is how a multi-line message goes missing.
 */
export function flakyAnnotations(tests: readonly FlakyTest[]): string[] {
  return tests.map(test => {
    const message =
      `${escapeCommandData(test.title)} passed only on retry ` +
      `(${String(test.attempts)} attempts). A retried pass and a first-attempt ` +
      `pass are the same colour in the job conclusion, so this is reported ` +
      `here rather than inferred from it.`;
    return `::warning file=${escapeCommandProperty(test.file)},title=Flaky test::${message}`;
  });
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

  onTestEnd(test: TestCase, result: TestResult): void {
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
      title: test.titlePath().slice(1).join(" › "),
      file: repoRelative(test.location.file),
      // `retry` is zero-based, so the run that finally passed is attempt N+1.
      attempts: result.retry + 1,
    });
  }

  onEnd(_result: FullResult): void {
    if (this.flaky.length === 0) return;
    for (const line of flakyAnnotations(this.flaky)) {
      process.stdout.write(`${line}\n`);
    }
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath === undefined || summaryPath === "") return;
    // Appended, never truncated: other steps write their own sections to this
    // same file, and a whole-file write would delete them.
    appendFileSync(summaryPath, flakySummary(this.flaky));
  }
}
