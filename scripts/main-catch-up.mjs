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
 * A run tested the commit when every substantive job named below reached a
 * verdict (`success` or `failure`), the same rule the superseded check uses to
 * find the last tested commit. A run still queued or running may yet test it,
 * so it is left to finish; if a newer push supersedes it, the next scheduled
 * look dispatches.
 *
 * Usage, in a workflow step: node scripts/main-catch-up.mjs
 * Reads GITHUB_REPOSITORY and GH_TOKEN.
 */
import { isCliEntry } from "./cli-entry.mjs";
import { githubJson, githubRequest } from "./github-api.mjs";
import { commandText } from "./workflow-context.mjs";

/**
 * The workflows to keep tested on `main`, each with the jobs whose verdicts
 * mean it tested a commit. Each list is the workflow's own `substantive-job`
 * input to `.github/actions/superseded-on-main`, which a test holds this to.
 */
export const WORKFLOWS = {
  "ci.yml": ["Lint / Typecheck / Test / Build"],
  "integration.yml": ["Integration (postgres)", "Integration (mysql)", "Integration (sqlite)"],
};

/** The events whose runs on `main` test a commit of it. */
const MAIN_EVENTS = new Set(["push", "workflow_dispatch"]);

const VERDICTS = new Set(["success", "failure"]);

/**
 * What to do for one workflow at `main`'s newest commit: nothing when a run
 * tested it or still might, dispatch when none did.
 *
 * @returns {Promise<{ action: "none" | "dispatch", reason: string }>}
 */
export async function decision(workflow, sha, { repository, context }) {
  const { workflow_runs: listed } = await githubJson(`repos/${repository}/actions/workflows/${workflow}/runs?branch=main&head_sha=${sha}&per_page=20`, context);
  const runs = listed.filter(run => MAIN_EVENTS.has(run.event));
  const unfinished = runs.find(run => run.status !== "completed");
  if (unfinished) return { action: "none", reason: `run ${unfinished.id} of ${sha.slice(0, 9)} is ${unfinished.status} and may still test it` };
  for (const run of runs) {
    const { jobs } = await githubJson(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`, context);
    if (tested(jobs, WORKFLOWS[workflow])) return { action: "none", reason: `run ${run.id} tested ${sha.slice(0, 9)}` };
  }
  return { action: "dispatch", reason: `no run tested ${sha.slice(0, 9)}` };
}

/** Whether every substantive job is present and reached a verdict. */
function tested(jobs, substantive) {
  return substantive.every(name => VERDICTS.has(jobs.find(job => job.name === name)?.conclusion));
}

/** Looks at `main`'s newest commit for each workflow, dispatches where none tested it, and returns the exit code. */
export async function main(env = process.env, { fetchImpl = fetch } = {}) {
  const repository = env.GITHUB_REPOSITORY;
  const context = { token: env.GH_TOKEN, fetchImpl };
  try {
    const { sha } = await githubJson(`repos/${repository}/commits/main`, context);
    for (const workflow of Object.keys(WORKFLOWS)) {
      const { action, reason } = await decision(workflow, sha, { repository, context });
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
