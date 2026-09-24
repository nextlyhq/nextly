#!/usr/bin/env node

/**
 * Whether a commit can affect a workflow's jobs, decided from the files it
 * changed, for a push to `main`, a pull request and the merge queue alike.
 *
 * A workflow whose jobs may become required checks cannot skip itself with
 * `on.paths-ignore`: a workflow filtered out that way never creates its checks,
 * and a required check that never reports blocks a pull request for good. It
 * runs instead, asks this, and skips its jobs by `if:`. A skipped job reports
 * `skipped`, which branch protection and the merge queue accept.
 *
 * Every answer this cannot read is `inert=false`: an event it has no rule for,
 * a base that is missing or unfetched, a diff that fails or lists nothing. A
 * broken comparison costs a full run rather than certifying a commit nobody
 * examined, which is the only safe direction for a filter in front of tests.
 *
 * Usage (in a workflow step, after a checkout with `fetch-depth: 0`):
 *   INERT_PATHS='<regex>' [ALWAYS_RUN_PATHS='<regex>'] [LAST_TESTED_SHA=<sha>] \
 *   [SUPERSEDED=true] [SCOPE_TITLE='CI scope'] node scripts/change-scope.mjs
 *
 * Reads the event from GITHUB_EVENT_NAME and GITHUB_EVENT_PATH, writes
 * `inert=true|false` to GITHUB_OUTPUT and the evidence to GITHUB_STEP_SUMMARY.
 */
import { appendFileSync } from "node:fs";

import { isCliEntry } from "./cli-entry.mjs";
import { eventPayload, readGit } from "./workflow-context.mjs";

/** A pattern no path matches, for a workflow with nothing it always runs for. */
const NEVER = /(?!)/;

/**
 * The commits whose difference is what a pull request or the merge queue asks
 * about. A pull request is compared from its merge base, because its base
 * moves as `main` advances and diffing from the tip would report every commit
 * `main` gained as though that pull request had made it. The queue's head is
 * built on its base (the latest `main`, then any pull requests ahead in the
 * queue, then this one), so its range is exact as given.
 */
const RANGES = {
  pull_request: payload => ({ base: payload.pull_request?.base?.sha, head: payload.pull_request?.head?.sha, mergeBase: true }),
  merge_group: payload => ({ base: payload.merge_group?.base_sha, head: payload.merge_group?.head_sha, mergeBase: false }),
};

/**
 * The range this run tests, from the event that started it. A push to `main`
 * is compared with the last commit the workflow actually tested, not the
 * previous commit: a documentation push landing after a superseded code push
 * would otherwise diff against that code push alone, read as inert, and leave
 * the code untested.
 *
 * @returns {{ base?: string, head?: string, mergeBase: boolean } | { reason: string }}
 */
export function diffRange({ event, payload = {}, lastTestedSha, sha }) {
  if (event === "push") return { base: lastTestedSha, head: sha, mergeBase: false };
  return Object.hasOwn(RANGES, event) ? RANGES[event](payload) : { reason: `no rule for a ${event || "missing"} event` };
}

/**
 * The files a range changed, or why they cannot be known.
 *
 * @returns {{ base: string, head: string, files: string[] } | { reason: string }}
 */
export function changedFiles(range, git = readGit) {
  const problem = rangeProblem(range, git);
  if (problem) return { reason: problem };
  const from = comparisonBase(range, git);
  if (!from) return { reason: `no merge base for ${range.base}..${range.head}` };
  return listChanges(from, range.head, git);
}

/** Why a range cannot be compared at all, or null. A first push reports an all-zero base, and a force push can leave one no longer fetchable. */
function rangeProblem({ base, head }, git) {
  if (!base || !head) return "no base or no head commit for this event";
  return git(["cat-file", "-e", `${base}^{commit}`]).ok ? null : `base ${base} is not present`;
}

function comparisonBase({ base, head, mergeBase }, git) {
  if (!mergeBase) return base;
  const found = git(["merge-base", base, head]);
  return found.ok ? found.out.trim() : "";
}

/**
 * The paths changed between two commits, NUL-separated so that a path git
 * would quote (a space, a non-ASCII name) is matched as it is spelled. No
 * files is not evidence of inertness; it is the shape of a comparison that
 * asked the wrong question.
 */
function listChanges(from, head, git) {
  const diff = git(["diff", "--name-only", "-z", from, head]);
  if (!diff.ok) return { reason: `could not diff ${from}..${head}` };
  const files = diff.out.split("\0").filter(Boolean);
  return files.length > 0 ? { base: from, head, files } : { reason: "the diff listed no files" };
}

/** The files that require the workflow to run: every one not proven inert, and every one it always runs for. */
export function filesThatRun(files, { inert, alwaysRun = NEVER }) {
  return files.filter(file => !inert.test(file) || alwaysRun.test(file));
}

/**
 * The decision for one run. A run that a newer push to `main` has overtaken
 * reads as inert, since nothing here needs to run; the reason is kept apart,
 * so it is never described as a run that touched only inert paths.
 */
export function decide({ event, payload, lastTestedSha, sha, superseded, inert, alwaysRun }, git = readGit) {
  if (superseded === "true") return { inert: true, superseded: true };
  const range = diffRange({ event, payload, lastTestedSha, sha });
  const changes = range.reason ? range : changedFiles(range, git);
  if (changes.reason) return { inert: false, reason: changes.reason };
  const running = filesThatRun(changes.files, { inert, alwaysRun });
  return { inert: running.length === 0, base: changes.base, head: changes.head, files: changes.files, running };
}

/**
 * The evidence for a decision, as Markdown. Named file by file rather than
 * counted: a summary saying "12 files skipped" is unreadable as evidence, and
 * the list is what lets someone notice a path that should never be on it.
 */
export function summary(result, title) {
  const heading = [`### ${title}`, ""];
  if (result.superseded) return [...heading, "A newer push to `main` already has a run; this one skips its jobs, and that run's verdict includes this commit."];
  if (result.reason) return [...heading, `Running everything: ${result.reason}.`];
  return [...heading, ...rangeSummary(result)];
}

function rangeSummary(result) {
  const counted = [`\`${result.base}\` → \`${result.head}\`, ${result.files.length} file(s) changed.`, ""];
  if (result.inert) return [...counted, "Every changed file is inert, so this workflow's jobs were skipped. Files:", "", ...bullets(result.files)];
  return [...counted, `Running in full. ${result.running.length} file(s) require it:`, "", ...firstTwenty(result.running)];
}

/** At most twenty, and how many more there were, so the list says what it is not showing. */
function firstTwenty(files) {
  const more = files.length > 20 ? [`- …and ${files.length - 20} more`] : [];
  return [...bullets(files.slice(0, 20)), ...more];
}

function bullets(files) {
  return files.map(file => `- \`${file}\``);
}

/** Runs the decision for the workflow step that invokes this file, and returns the exit code. */
export function main(env = process.env, git = readGit) {
  if (!env.INERT_PATHS) {
    console.error("change-scope: INERT_PATHS is required — the paths this workflow may skip for");
    return 64;
  }
  const result = decide(
    {
      event: env.GITHUB_EVENT_NAME,
      payload: eventPayload(env),
      lastTestedSha: env.LAST_TESTED_SHA,
      sha: env.GITHUB_SHA,
      superseded: env.SUPERSEDED,
      inert: new RegExp(env.INERT_PATHS),
      alwaysRun: env.ALWAYS_RUN_PATHS ? new RegExp(env.ALWAYS_RUN_PATHS) : NEVER,
    },
    git
  );
  report(result, env);
  return 0;
}

function report(result, env) {
  const line = notice(result);
  if (line) console.log(line);
  appendTo(env.GITHUB_STEP_SUMMARY, `${summary(result, env.SCOPE_TITLE || "Scope").join("\n")}\n`);
  appendTo(env.GITHUB_OUTPUT, `inert=${result.inert}\n`);
  console.log(`change-scope: inert=${result.inert}`);
}

function notice(result) {
  if (result.superseded) return "::notice title=Superseded::a newer push to main already has a run; this one skips its jobs.";
  return result.reason ? `::notice title=Full run::${result.reason}; running everything.` : null;
}

function appendTo(path, text) {
  if (path) appendFileSync(path, text);
}

if (isCliEntry(import.meta.url)) process.exit(main());
