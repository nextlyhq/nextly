#!/usr/bin/env node

/**
 * Cancels the queued and running pull-request runs of a pull request that has
 * just been merged or closed. Nobody will read those runs' results, and on a
 * plan with a fixed number of concurrent jobs each one holds a runner that
 * another pull request's checks are waiting for.
 *
 * A concurrency group cancels a run only when a newer run joins it, and
 * closing a pull request starts none, so this is done here, once, for every
 * workflow, rather than by giving each workflow a `closed` trigger whose jobs
 * would all have to skip on it.
 *
 * Only runs started by a pull request's own events are cancelled. A push to
 * `main`, the merge queue and a schedule are never touched: those runs are
 * what `main`'s verdict is made of. A run belongs to the pull request when
 * GitHub lists it on the run; a run from a fork lists none, so it belongs when
 * it ran on the pull request's head branch in the pull request's head
 * repository and lists no other pull request.
 *
 * Usage, in a workflow step on `pull_request: closed`:
 *   node scripts/cancel-closed-pull-request-runs.mjs
 * Reads GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_RUN_ID and GH_TOKEN.
 */
import { isCliEntry } from "./cli-entry.mjs";
import { commandText, eventPayload } from "./workflow-context.mjs";

/** The events a pull request's own runs start from. */
const PULL_REQUEST_EVENTS = new Set(["pull_request", "pull_request_target"]);

/** The states of a run that has not finished, each listed by the API on its own. */
const UNFINISHED = ["queued", "in_progress", "waiting", "pending", "requested"];

/** Pages of 100 read per state; a longer list is refused rather than cut short. */
const MAX_PAGES = 20;

async function api(path, { token, fetchImpl }, method = "GET") {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/${path}`, { method, headers });
  return response;
}

async function getJson(path, context) {
  const response = await api(path, context);
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  return response.json();
}

/** Every unfinished run in the repository, each state read to its last page. */
async function unfinishedRuns(repository, context) {
  const runs = [];
  for (const status of UNFINISHED) runs.push(...(await allPages(`repos/${repository}/actions/runs?status=${status}`, context)));
  return runs;
}

async function allPages(path, context) {
  const runs = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { workflow_runs: items } = await getJson(`${path}&per_page=100&page=${page}`, context);
    runs.push(...items);
    if (items.length < 100) return runs;
  }
  throw new Error(`more than ${MAX_PAGES * 100} runs at ${path}; refusing to cancel from a list cut short`);
}

/**
 * The runs of the closed pull request that may be cancelled: started by its
 * own events, unfinished, and not the run doing the cancelling.
 */
export function runsOf(pull, runs, ownRunId) {
  return runs.filter(run => PULL_REQUEST_EVENTS.has(run.event) && String(run.id) !== String(ownRunId) && belongsTo(pull, run));
}

function belongsTo(pull, run) {
  const listed = (run.pull_requests ?? []).map(entry => entry.number);
  if (listed.length > 0) return listed.includes(pull.number);
  return run.head_branch === pull.head?.ref && run.head_repository?.full_name === pull.head?.repo?.full_name;
}

/**
 * Cancels each run, and returns how each went. A run that finished in the
 * meantime answers 409, which is the outcome wanted, not a failure.
 */
export async function cancelAll(runs, repository, context) {
  const outcomes = [];
  for (const run of runs) {
    const response = await api(`repos/${repository}/actions/runs/${run.id}/cancel`, context, "POST");
    outcomes.push({ id: run.id, workflow: run.name, status: response.status, ok: response.ok || response.status === 409 });
  }
  return outcomes;
}

/** Cancels the closed pull request's runs, and returns the exit code. */
export async function main(env = process.env, { fetchImpl = fetch } = {}) {
  const pull = eventPayload(env).pull_request;
  if (!pull?.number) return refuse("the event names no pull request");
  const context = { token: env.GH_TOKEN, fetchImpl };
  try {
    const runs = runsOf(pull, await unfinishedRuns(env.GITHUB_REPOSITORY, context), env.GITHUB_RUN_ID);
    const outcomes = await cancelAll(runs, env.GITHUB_REPOSITORY, context);
    for (const outcome of outcomes) console.log(`cancel-closed-pull-request-runs: ${outcome.workflow} run ${outcome.id}: HTTP ${outcome.status}`);
    console.log(`cancel-closed-pull-request-runs: #${pull.number} had ${runs.length} unfinished pull-request run(s)`);
    const failed = outcomes.filter(outcome => !outcome.ok);
    return failed.length === 0 ? 0 : refuse(`could not cancel ${failed.length} run(s): ${failed.map(outcome => outcome.id).join(", ")}`);
  } catch (error) {
    return refuse(`could not read or cancel #${pull.number}'s runs (${error.message})`);
  }
}

function refuse(problem) {
  console.log(`::error title=Cancel closed pull request runs::${commandText(problem)}`);
  return 1;
}

if (isCliEntry(import.meta.url)) process.exit(await main());
