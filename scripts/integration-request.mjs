#!/usr/bin/env node

/**
 * Whether Integration's database legs run on a pull request, and how adding
 * the label starts them.
 *
 * A pull request runs the legs only while it carries `run-integration`; the
 * merge queue and pushes to `main` always run them, so nothing merges
 * untested. The labels are read from the API when Integration's `changes` job
 * runs, not from the event that started the run: the event's copy is fixed at
 * the push, and a re-run keeps it, so it would never see a label added since.
 *
 * Adding the label does not trigger Integration itself, because then every
 * label would: another full run on a pull request already labelled, or a later
 * `skipped` run on the same commit that hides the first run's result. Instead
 * `.github/workflows/integration-request.yml` runs on that one label and
 * re-runs the head's Integration run, but only once its legs have skipped.
 *
 * Every answer this cannot read runs the legs (`requested=true`): a broken
 * question costs a full run rather than a skipped check nobody asked for.
 *
 * Usage, in a workflow step:
 *   node scripts/integration-request.mjs requested   (Integration's `changes` job)
 *   node scripts/integration-request.mjs rerun       (integration-request.yml)
 * Reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY and GH_TOKEN;
 * `requested` writes `requested=true|false` to GITHUB_OUTPUT.
 */
import { appendFileSync } from "node:fs";

import { isCliEntry } from "./cli-entry.mjs";
import { githubJson, githubWrite } from "./github-api.mjs";
import { commandText, eventPayload } from "./workflow-context.mjs";

/** The label that asks for the legs on a pull request. */
export const LABEL = "run-integration";

/** The job, and its step, that read the labels; until that step has run, a run will see a label added now. */
export const DECIDING_JOB = "Decide what this commit can affect";
export const ASKING_STEP = "Ask whether the legs were requested";

/** How long `rerun` waits for a run whose labels were already read to finish: its skipped legs end it within seconds. */
const WAIT = { tries: 30, everyMs: 20_000 };

/** A GET's JSON or a write; any failure throws, for the caller to turn into its safe answer. */
const api = (path, context, method = "GET") => (method === "GET" ? githubJson(path, context) : githubWrite(path, context, method));

/**
 * Whether this run's legs were asked for. Outside a pull request always; on
 * one, only while its labels, read now, include the label.
 *
 * @returns {Promise<{ requested: boolean, reason: string }>}
 */
export async function requested({ event, payload = {}, repository, token, fetchImpl }) {
  if (event !== "pull_request") return { requested: true, reason: `a ${event || "missing"} event always runs the legs` };
  const number = payload.pull_request?.number;
  if (!number) return { requested: true, reason: "the event names no pull request" };
  try {
    const labels = await api(`repos/${repository}/issues/${number}/labels?per_page=100`, { token, fetchImpl });
    const asked = labels.some(label => label.name === LABEL);
    return { requested: asked, reason: asked ? `#${number} carries \`${LABEL}\`` : `#${number} does not carry \`${LABEL}\`` };
  } catch (error) {
    return { requested: true, reason: `could not read #${number}'s labels (${error.message})` };
  }
}

/**
 * What adding the label should do to the newest Integration run of a
 * labelled pull request's head: nothing while that run has yet to read the labels, wait
 * while it is finishing, re-run it once its legs have all skipped, and nothing
 * when they ran.
 *
 * @returns {Promise<{ action: "none" | "wait" | "rerun", reason: string, run?: number }>}
 */
export async function rerunDecision({ payload = {}, repository, token, fetchImpl }) {
  const sha = payload.pull_request?.head?.sha;
  if (!sha) return { action: "none", reason: "the event names no head commit" };
  const context = { token, fetchImpl };
  const { workflow_runs: runs } = await api(`repos/${repository}/actions/workflows/integration.yml/runs?event=pull_request&head_sha=${sha}&per_page=20`, context);
  const run = newest(runs);
  if (!run) return { action: "none", reason: `no Integration run of ${sha.slice(0, 9)} yet; the one that starts reads the label itself` };
  const { jobs } = await api(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`, context);
  if (!labelsRead(deciding(jobs))) return { action: "none", reason: `run ${run.id} has not read the labels yet, and will see this one` };
  // Until the deciding job has finished, its legs wait on it, queued with no
  // conclusion whichever way the labels were read, so they say nothing yet.
  if (deciding(jobs).status !== "completed") return { action: "wait", reason: `run ${run.id} read the labels before this one and is still deciding`, run: run.id };
  // After it, a leg that skips is created already finished and one that runs
  // is queued or running, so the legs' own states say which way they were read.
  const legs = jobs.filter(job => job.name.startsWith("Integration ("));
  if (legs.some(leg => leg.conclusion !== "skipped")) return { action: "none", reason: `run ${run.id}'s legs ran or are running` };
  if (legs.length === 0 || run.status !== "completed") return { action: "wait", reason: `run ${run.id} read the labels before this one and is finishing`, run: run.id };
  return { action: "rerun", reason: `run ${run.id}'s legs skipped`, run: run.id };
}

/** The run's job that reads the labels, if the API lists it yet. */
function deciding(jobs) {
  return jobs.find(job => job.name === DECIDING_JOB);
}

/**
 * Whether the run has read the labels: its asking step has finished. The job
 * can still be running after that step (its later steps and clean-up), so the
 * job's own status would read as unread too long; it stands in only when the
 * API lists no steps.
 */
function labelsRead(job) {
  if (!job) return false;
  const asking = (job.steps ?? []).find(step => step.name === ASKING_STEP);
  return (asking ?? job).status === "completed";
}

/** The most recently created run; the list's order is GitHub's to change. */
function newest(runs = []) {
  return runs.reduce((latest, run) => (!latest || run.created_at > latest.created_at ? run : latest), undefined);
}

/** Answers `requested` for the workflow step, and returns the exit code. */
async function mainRequested(env, fetchImpl) {
  const answer = await requested({ event: env.GITHUB_EVENT_NAME, payload: eventPayload(env), repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN, fetchImpl });
  console.log(`integration-request: requested=${answer.requested} (${answer.reason})`);
  if (!answer.requested && env.INERT !== "true") {
    console.log(`::notice title=Integration not requested::${commandText(`${answer.reason}, so the database legs skip; add the label to run them. The merge queue runs them regardless.`)}`);
    appendTo(env.GITHUB_STEP_SUMMARY, `### Integration on request\n\nThis pull request does not carry \`${LABEL}\`, so the database legs skip here. Add the label to run them; the merge queue runs them before any merge.\n`);
  }
  appendTo(env.GITHUB_OUTPUT, `requested=${answer.requested}\n`);
  return 0;
}

/** Acts on `rerunDecision` for the label's workflow, waiting while a run finishes, and returns the exit code. */
async function mainRerun(env, fetchImpl, sleep) {
  const context = { payload: eventPayload(env), repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN, fetchImpl };
  try {
    for (let attempt = 1; attempt <= WAIT.tries; attempt += 1) {
      const decision = await rerunDecision(context);
      console.log(`integration-request: ${decision.action} (${decision.reason})`);
      if (decision.action === "none") return 0;
      if (decision.action === "rerun") {
        await api(`repos/${env.GITHUB_REPOSITORY}/actions/runs/${decision.run}/rerun`, context, "POST");
        return 0;
      }
      await sleep(WAIT.everyMs);
    }
    return refuse(`the head's Integration run did not finish within ${(WAIT.tries * WAIT.everyMs) / 60_000} minutes; re-run it by hand`);
  } catch (error) {
    return refuse(`could not start Integration (${error.message}); re-run the head's Integration run by hand`);
  }
}

function refuse(problem) {
  console.log(`::error title=Integration request::${commandText(problem)}`);
  return 1;
}

function appendTo(path, text) {
  if (path) appendFileSync(path, text);
}

/** Runs the command a workflow step names, and returns the exit code. */
export async function main(argv = process.argv.slice(2), env = process.env, { fetchImpl = fetch, sleep = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  if (argv[0] === "requested") return mainRequested(env, fetchImpl);
  if (argv[0] === "rerun") return mainRerun(env, fetchImpl, sleep);
  console.error("usage: node scripts/integration-request.mjs requested|rerun");
  return 64;
}

if (isCliEntry(import.meta.url)) process.exit(await main());
