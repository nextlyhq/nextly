#!/usr/bin/env node

/**
 * Starts a run of CI and of Integration on `main`'s newest commit when no run
 * has tested it.
 *
 * On a busy day every push to `main` supersedes the one before: each run sees
 * a newer one, skips its jobs, and its gate refuses rather than passes
 * (`scripts/ci-gate.mjs`). The newest commit's own run is the one meant to test
 * everything, but it too is superseded the moment another push lands, so
 * while merges keep coming nothing may test `main` at all. This runs on a
 * schedule (`.github/workflows/main-catch-up.yml`) and closes that gap: for
 * each workflow, if the newest commit has no run that tested it and none that
 * still can, it dispatches one. A dispatched run tests everything, so it
 * covers every change since the last commit that was tested.
 *
 * A run tested the commit when every job its verdict stands on, named below,
 * reached a verdict (`success` or `failure`): for CI, every job `CI gate`
 * needs; for Integration, every job that runs a suite. A run still queued or running may yet
 * test it, so it is left to finish; if a newer push supersedes it, the next
 * scheduled look dispatches. A commit gets one catch-up run, never a second:
 * when that run ends without testing it (a job cancelled or timed out), the
 * red or cancelled result stands for someone to read, and dispatching again
 * every two hours would only repeat it.
 *
 * Except when runners are starved. Then the newest commit's push run is always
 * still queued when this looks, and is superseded by the time it starts, so
 * waiting for it waits for ever while merges keep coming. Once main's last
 * verdict for a workflow is older than `MAX_VERDICT_AGE_MS`, a queued run no
 * longer counts and a run is dispatched on main; a dispatched run is never
 * skipped as superseded. One catch-up run at a time: while one is still on its
 * way, nothing more is started, so a slow queue never piles them up.
 *
 * Usage, in a workflow step: node scripts/main-catch-up.mjs
 * Reads GITHUB_REPOSITORY and GH_TOKEN.
 */
import { isCliEntry } from "./cli-entry.mjs";
import { githubJson, githubRequest } from "./github-api.mjs";
import { commandText } from "./workflow-context.mjs";

/**
 * The workflows to keep tested on `main`, each with the jobs its verdict stands
 * on: for CI, every job `CI gate` needs; for Integration, every job that runs
 * a suite (each shard of every leg, since all three are sharded). A name
 * ending in " (" stands for a matrix job's every instance, whose names add the
 * matrix value. A test holds each list to the workflow file.
 */
export const WORKFLOWS = {
  "ci.yml": [
    "Decide what this commit can affect",
    "Comment convention (describes code, not process)",
    "Lint / Typecheck / Test / Build",
    "Unit tests (nextly)",
    "Unit tests (admin)",
    "Published admin build",
    "CLI entry guard (",
    // Not in CI gate (it does not block a merge), but a commit whose browser
    // suite never reached a verdict is not tested.
    "Browser tests",
  ],
  "integration.yml": [
    "Integration (postgres) shard (1)",
    "Integration (postgres) shard (2)",
    "Integration (postgres) shard (3)",
    "Integration (mysql) shard (1)",
    "Integration (mysql) shard (2)",
    "Integration (mysql) shard (3)",
    "Integration (sqlite) shard (1)",
    "Integration (sqlite) shard (2)",
    "Integration (sqlite) shard (3)",
  ],
};

/** How old main's last verdict may grow before a queued run stops counting as on its way. */
export const MAX_VERDICT_AGE_MS = 3 * 3_600_000;

/** The events whose runs on `main` test a commit of it. */
const MAIN_EVENTS = new Set(["push", "workflow_dispatch"]);

const VERDICTS = new Set(["success", "failure"]);

/**
 * What to do for one workflow at `main`'s newest commit: nothing when a run
 * tested it or still might, dispatch when none did.
 *
 * @returns {Promise<{ action: "none" | "dispatch", reason: string }>}
 */
export async function decision(workflow, sha, { repository, context, now = Date.now() }) {
  const { workflow_runs: listed } = await githubJson(`repos/${repository}/actions/workflows/${workflow}/runs?branch=main&head_sha=${sha}&per_page=20`, context);
  const runs = listed.filter(run => MAIN_EVENTS.has(run.event));
  const unfinished = runs.find(run => run.status !== "completed");
  if (unfinished) {
    const recent = await recentRuns(workflow, { repository, context });
    const pending = recent.find(run => run.event === "workflow_dispatch" && run.status !== "completed");
    if (pending) return { action: "none", reason: `catch-up run ${pending.id} is ${pending.status}; one at a time` };
    const verdict = await lastVerdict(workflow, recent, { repository, context });
    const age = verdict ? now - Date.parse(verdict.updated_at) : Infinity;
    if (age <= MAX_VERDICT_AGE_MS) {
      return { action: "none", reason: `run ${unfinished.id} of ${sha.slice(0, 9)} is ${unfinished.status} and may still test it` };
    }
    const since = verdict ? `${(age / 3_600_000).toFixed(1)} h ago (run ${verdict.id})` : "not in main's recent runs";
    return { action: "dispatch", reason: `run ${unfinished.id} of ${sha.slice(0, 9)} is ${unfinished.status}, but main's last verdict was ${since}` };
  }
  const caughtUp = runs.find(run => run.event === "workflow_dispatch");
  if (caughtUp) return { action: "none", reason: `catch-up run ${caughtUp.id} already ran on ${sha.slice(0, 9)}; its result stands` };
  for (const run of runs) {
    const { jobs } = await githubJson(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`, context);
    if (tested(jobs, WORKFLOWS[workflow])) return { action: "none", reason: `run ${run.id} tested ${sha.slice(0, 9)}` };
  }
  return { action: "dispatch", reason: `no run tested ${sha.slice(0, 9)}` };
}

/** Main's recent runs of a workflow that can test a commit of it, newest first. */
async function recentRuns(workflow, { repository, context }) {
  const { workflow_runs: listed } = await githubJson(`repos/${repository}/actions/workflows/${workflow}/runs?branch=main&per_page=50`, context);
  return listed.filter(run => MAIN_EVENTS.has(run.event));
}

/**
 * The newest of `runs` that tested its commit, or none. Only the newest
 * `VERDICT_SCAN` finished runs are read, a request each: under starvation most
 * of them were skipped as superseded, and that many without a verdict already
 * means main has gone untested too long.
 */
const VERDICT_SCAN = 20;
async function lastVerdict(workflow, runs, { repository, context }) {
  for (const run of runs.filter(entry => entry.status === "completed").slice(0, VERDICT_SCAN)) {
    const { jobs } = await githubJson(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`, context);
    if (tested(jobs, WORKFLOWS[workflow])) return run;
  }
  return null;
}

/** Whether every job the verdict stands on is present and reached one; a matrix name stands for all its instances, and at least one. */
function tested(jobs, gated) {
  return gated.every(name => {
    const matching = name.endsWith(" (") ? jobs.filter(job => job.name.startsWith(name)) : jobs.filter(job => job.name === name);
    return matching.length > 0 && matching.every(job => VERDICTS.has(job.conclusion));
  });
}

/** Looks at `main`'s newest commit for each workflow, dispatches where none tested it, and returns the exit code. */
export async function main(env = process.env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const repository = env.GITHUB_REPOSITORY;
  const context = { token: env.GH_TOKEN, fetchImpl };
  try {
    const { sha } = await githubJson(`repos/${repository}/commits/main`, context);
    for (const workflow of Object.keys(WORKFLOWS)) {
      const { action, reason } = await decision(workflow, sha, { repository, context, now });
      console.log(`main-catch-up: ${workflow}: ${action} (${reason})`);
      if (action === "dispatch") await dispatch(workflow, repository, context);
    }
    return 0;
  } catch (error) {
    console.log(`::error title=Main catch-up::${commandText(`could not check or start main's runs (${error.message})`)}`);
    return 1;
  }
}

/** Starts one run of the workflow on `main`; GitHub answers 204 when it is accepted. */
async function dispatch(workflow, repository, context) {
  const response = await githubRequest(`repos/${repository}/actions/workflows/${workflow}/dispatches`, context, "POST", { ref: "main" });
  if (!response.ok) throw new Error(`dispatching ${workflow}: HTTP ${response.status}`);
}

if (isCliEntry(import.meta.url)) process.exit(await main());
