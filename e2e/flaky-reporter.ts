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
      `${test.title} passed only on retry (${String(test.attempts)} attempts). ` +
      `A retried pass and a first-attempt pass are the same colour in the job ` +
      `conclusion, so this is reported here rather than inferred from it.`;
    return `::warning file=${test.file},title=Flaky test::${message}`;
  });
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
    .map(t => `| \`${t.title}\` | ${t.file} | ${String(t.attempts)} |`)
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

export default class FlakyReporter implements Reporter {
  private readonly flaky: FlakyTest[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    // `outcome()` is Playwright's own classification and already accounts for
    // expected failures, so a `test.fail()` that fails and then passes is not
    // reported here as flaky. Recomputing it from `result.status` would be a
    // second implementation of a question Playwright already answers.
    if (test.outcome() !== "flaky") return;
    this.flaky.push({
      title: test.titlePath().slice(1).join(" › "),
      file: test.location.file.replace(`${process.cwd()}/`, ""),
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
