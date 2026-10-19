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
 * what `main`'s verdict is made of. A run belongs to a closed pull request
 * when GitHub lists that pull request on the run; a run from a fork lists
 * none, so it belongs when it ran on that pull request's head branch, in its
 * head repository, and lists no other pull request.
 *
 * Usage, in a workflow step on `pull_request: closed`:
 *   node scripts/cancel-closed-pull-request-runs.mjs
 * Reads GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_RUN_ID and GH_TOKEN.
 */
import { isCliEntry } from "./cli-entry.mjs";
import { githubJson, githubRequest } from "./github-api.mjs";
import { commandText, eventPayload } from "./workflow-context.mjs";

/** The events a pull request's own runs start from. */
const PULL_REQUEST_EVENTS = new Set(["pull_request", "pull_request_target"]);

/**
 * The states of a run that has not finished, each listed by the API on its
 * own, in the order a run moves through them: a run that moves on between two
 * reads is then read again in its later state, not missed.
 */
const UNFINISHED = ["requested", "waiting", "pending", "queued", "in_progress"];

/** GitHub lists at most 1,000 runs for one filter: ten pages of 100. */
const MAX_PAGES = 10;

/** Scans of the whole list; another runs while the one before found runs to cancel, since runs move between states as they are read. */
const MAX_PASSES = 3;

/**
 * Every unfinished run a pull request's own events started, each event and
 * state read to its last page, and the lists that came back shorter than
 * GitHub's total for them. Filtering by event keeps each list well under the
 * API's 1,000-run window, and runs of other events are never wanted.
 */
async function unfinishedRuns(repository, context) {
  const runs = [];
  const short = [];
  for (const status of UNFINISHED) {
    for (const event of PULL_REQUEST_EVENTS) {
      const list = await allPages(`repos/${repository}/actions/runs?event=${event}&status=${status}`, context);
      runs.push(...list.runs);
      if (list.short) short.push(list.short);
    }
  }
  return { runs, short };
}

/**
 * Every page of one list, and whether it came back shorter than the total
 * GitHub reports for it. On a busy queue runs arrive while a list is read,
 * so the total and the pages can disagree by a run or two, and the 1,000-run
 * window can hide more. A short list is reported, never taken as whole; the
 * runs it does hold are still the closed pull request's to cancel.
 */
async function allPages(path, context) {
  const runs = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { total_count: count, workflow_runs: items } = await githubJson(`${path}&per_page=100&page=${page}`, context);
    total = Math.max(total, count ?? 0);
    runs.push(...items);
    if (items.length < 100) break;
  }
  return { runs, short: runs.length < total ? `${path} listed ${runs.length} of ${total}` : null };
}

/**
 * The runs of the closed pull request that may be cancelled: started by its
 * own events, unfinished, and not the run doing the cancelling.
 */
export function runsOf(pull, runs, ownRunId) {
  return runs.filter(run => PULL_REQUEST_EVENTS.has(run.event) && String(run.id) !== String(ownRunId) && startedBeforeClosing(pull, run) && belongsTo(pull, run));
}

/**
 * Whether a run began before its pull request closed. A run created after
 * that belongs to a reopening, which this run, queued since the close, must not
 * cancel. A pull request with no closing time leaves every run in.
 */
function startedBeforeClosing(pull, run) {
  return !pull.closed_at || !run.created_at || run.created_at <= pull.closed_at;
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
    const response = await githubRequest(`repos/${repository}/actions/runs/${run.id}/cancel`, context, "POST");
    outcomes.push({ id: run.id, workflow: run.name, status: response.status, ok: response.ok || response.status === 409 });
  }
  return outcomes;
}

/**
 * Scans and cancels until a scan finds nothing new and every list in it was
 * whole, at most `MAX_PASSES` times: a run that moved between states, or
 * arrived, while one scan read the lists is found by the next. Each scan
 * cancels what it found, so one short list never holds back the rest. The
 * last scan's short lists are returned, for the caller to report.
 */
async function cancelInPasses(pull, env, context) {
  const runs = [];
  const outcomes = [];
  let short = [];
  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    const seen = new Set(runs.map(run => run.id));
    const scan = await unfinishedRuns(env.GITHUB_REPOSITORY, context);
    // A run can appear on two pages while the queue moves under the read, so each is taken once.
    const found = [...new Map(runsOf(pull, scan.runs, env.GITHUB_RUN_ID).map(run => [run.id, run])).values()].filter(run => !seen.has(run.id));
    short = scan.short;
    runs.push(...found);
    outcomes.push(...(await cancelAll(found, env.GITHUB_REPOSITORY, context)));
    if (found.length === 0 && short.length === 0) break;
  }
  return { runs, outcomes, short };
}

/** Cancels the closed pull request's runs, and returns the exit code. */
export async function main(env = process.env, { fetchImpl = fetch } = {}) {
  const pull = eventPayload(env).pull_request;
  if (!pull?.number) return refuse("the event names no pull request");
  const context = { token: env.GH_TOKEN, fetchImpl };
  try {
    // This run can wait in the queue long after the close. If its pull
    // request was reopened meanwhile, those runs are wanted again.
    const now = await githubJson(`repos/${env.GITHUB_REPOSITORY}/pulls/${pull.number}`, context);
    if (now.state === "open") {
      console.log(`cancel-closed-pull-request-runs: #${pull.number} is open again; nothing cancelled`);
      return 0;
    }
    const { runs, outcomes, short } = await cancelInPasses(pull, env, context);
    for (const outcome of outcomes) console.log(`cancel-closed-pull-request-runs: ${outcome.workflow} run ${outcome.id}: HTTP ${outcome.status}`);
    console.log(`cancel-closed-pull-request-runs: #${pull.number} had ${runs.length} unfinished pull-request run(s)`);
    const failed = outcomes.filter(outcome => !outcome.ok);
    if (failed.length > 0) return refuse(`could not cancel ${failed.length} run(s): ${failed.map(outcome => outcome.id).join(", ")}`);
    return short.length === 0 ? 0 : refuse(`cancelled what was listed, but the last scan's lists were short, so a run may remain: ${short.join("; ")}`);
  } catch (error) {
    return refuse(`could not read or cancel #${pull.number}'s runs (${error.message})`);
  }
}

function refuse(problem) {
  console.log(`::error title=Cancel closed pull request runs::${commandText(problem)}`);
  return 1;
}

if (isCliEntry(import.meta.url)) process.exit(await main());
