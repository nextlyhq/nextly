#!/usr/bin/env node

/**
 * Whether a pull request's unit tests may be narrowed to the files its change
 * can affect, and the two checks that keep that narrowing honest.
 *
 * A narrowed pull request is safe only when nothing reaches `main` without the
 * merge queue's full run. A ruleset bypass lets a pull request merge on its own
 * checks, so while one exists every pull request must test everything. A
 * workflow's token cannot read a ruleset's bypass actors (only an admin can),
 * so no run can prove there are none. The answer is split by who can see what:
 *
 * - `select`, on every pull-request run: selection is on only while the
 *   repository variable `NEXTLY_PR_TEST_SELECTION` is `on`, a switch the
 *   repository's owner flips once the last bypass is gone, AND `main`'s rules
 *   (readable without a token) still include the merge queue. A run that cannot
 *   read the rules tests everything; a run that reads them without the queue
 *   tests everything and fails, because the switch is on with nothing behind it.
 * - `tripwire`, on each push to `main` while the switch is on: a queue merge
 *   lands the very commit the queue tested, so every first-parent commit a push
 *   brings must have a `merge_group` run on its own SHA. One without came in
 *   directly, which means a bypass exists, and the run fails saying so. It
 *   cannot stop that merge; it makes the first one loud, and `main`'s own run
 *   still tests everything the merge brought.
 * - `enablement`, run by hand with an admin login before the switch is flipped:
 *   every ruleset that applies to `main` is read with its bypass actors, and
 *   the verdict is printed, to be quoted where selection is switched on.
 *
 * Usage:
 *   node scripts/merge-path.mjs select                    # a workflow step; sets NEXTLY_UNIT_TESTS in GITHUB_ENV
 *   node scripts/merge-path.mjs tripwire <before> <after> # a workflow step on push to main
 *   node scripts/merge-path.mjs enablement                # by hand, with GH_TOKEN of an admin
 * Reads GITHUB_REPOSITORY (default nextlyhq/nextly), GH_TOKEN or GITHUB_TOKEN,
 * GITHUB_EVENT_NAME and NEXTLY_PR_TEST_SELECTION.
 */
import { appendFileSync } from "node:fs";

import { isCliEntry } from "./cli-entry.mjs";
import { githubJson } from "./github-api.mjs";

/** The repository variable that switches pull-request selection on. Only `on` does. */
export const SELECTION_SWITCH = "NEXTLY_PR_TEST_SELECTION";

/** Whether a branch's rules, as `GET repos/{repo}/rules/branches/{branch}` returns them, include the merge queue. */
function hasMergeQueue(rules) {
  return Array.isArray(rules) && rules.some(rule => rule?.type === "merge_queue");
}

/**
 * How one CI run tests its unit lanes: `select` (the affected files and the
 * guards), `shadow` (everything, with the selection computed and reported
 * beside it), or `full` (everything). `guardFailure` is set when the run must
 * fail as well. `rules` is null when they could not be read.
 *
 * Every undecidable case tests everything: narrowing is the one direction that
 * can let an untested change through, so it needs every condition met.
 */
export function selectionMode({ event, switchValue, rules }) {
  if (event !== "pull_request") {
    return { mode: "full", reason: `a ${event} run tests everything`, guardFailure: null };
  }
  if (switchValue !== "on") {
    return {
      mode: "shadow",
      reason: `${SELECTION_SWITCH} is not on, so a pull request tests everything and its selection is only reported`,
      guardFailure: null,
    };
  }
  if (rules === null) {
    return { mode: "full", reason: "main's rules could not be read, so whether the queue is the only path is unknown", guardFailure: null };
  }
  if (!hasMergeQueue(rules)) {
    return {
      mode: "full",
      reason: "main has no merge_queue rule",
      guardFailure: `${SELECTION_SWITCH} is on, but main has no merge_queue rule, so a pull request can merge without the queue's full run. Switch ${SELECTION_SWITCH} off until the queue is the only merge path.`,
    };
  }
  return { mode: "select", reason: "selection is on and main merges only through the queue", guardFailure: null };
}

/**
 * The first-parent commits a push brought, newest first, from the commits a
 * compare between `before` and `after` returned; null when that list does not
 * reach from `after` back to `before`, which is a partial read rather than a
 * short push.
 *
 * First parents only: a pull request merged with a merge commit brings its
 * branch's own commits as second parents, and those were never meant to be
 * queued on their own.
 */
export function firstParentChain(commits, before, after) {
  const bySha = new Map(commits.map(commit => [commit.sha, commit]));
  const chain = [];
  for (let sha = after; sha !== before; ) {
    const commit = bySha.get(sha);
    if (!commit) return null;
    chain.push(sha);
    sha = commit.parents?.[0]?.sha;
    if (typeof sha !== "string") return null;
  }
  return chain;
}

/** The commits in `chain` that have no `merge_group` run, by `queued(sha)`; any unknown answer is returned as null. */
export function directMerges(chain, queued) {
  const answers = chain.map(sha => ({ sha, queued: queued(sha) }));
  if (answers.some(answer => answer.queued === null)) return null;
  return answers.filter(answer => !answer.queued).map(answer => answer.sha);
}

/**
 * What stands between `main` and a merge that skips the queue, from every
 * ruleset that applies to it, each as `GET repos/{repo}/rulesets/{id}` returns
 * it to its reader. Empty means none.
 *
 * A ruleset read without admin rights carries no `bypass_actors` at all, which
 * is "could not look", not "nobody", so it is a problem in its own right.
 */
export function directPaths(rulesets, branchRules) {
  const problems = [];
  if (!hasMergeQueue(branchRules)) problems.push("main has no merge_queue rule");
  for (const ruleset of rulesets) {
    const name = `ruleset ${ruleset.id} (${ruleset.name})`;
    if (ruleset.enforcement !== "active") problems.push(`${name} is ${ruleset.enforcement}, not active`);
    if (!Array.isArray(ruleset.bypass_actors)) {
      problems.push(`${name}'s bypass actors could not be read: run this with an admin's GH_TOKEN`);
    } else {
      for (const actor of ruleset.bypass_actors) {
        const who = [actor.actor_type, actor.actor_id].filter(part => part !== undefined && part !== null).join(" ");
        problems.push(`${name} lets ${who} bypass it (${actor.bypass_mode})`);
      }
    }
  }
  return problems;
}

/** A GitHub read's JSON, or null when it failed. */
async function readOrNull(path, context) {
  try {
    return await githubJson(path, context);
  } catch (error) {
    console.log(`merge-path: ${error.message}`);
    return null;
  }
}

/**
 * The job variable later steps read the mode from. A variable rather than a
 * step output, so a step's condition can test it without naming this step:
 * the full suite runs whenever it is not exactly `select`, including when this
 * step failed or never ran.
 */
export const MODE_VARIABLE = "NEXTLY_UNIT_TESTS";

/** Sets a variable for the job's later steps, when there is a job to set it for. */
function setJobVariable(env, name, value) {
  if (env.GITHUB_ENV) appendFileSync(env.GITHUB_ENV, `${name}=${value}\n`);
}

async function select(env, context, repo) {
  const event = env.GITHUB_EVENT_NAME ?? "";
  const switchValue = env[SELECTION_SWITCH] ?? "";
  // Read only when the answer can depend on it, so a push or a queue run asks GitHub nothing.
  const rules = event === "pull_request" && switchValue === "on" ? await readOrNull(`repos/${repo}/rules/branches/main`, context) : [];
  const verdict = selectionMode({ event, switchValue, rules });
  console.log(`merge-path: ${verdict.mode}, because ${verdict.reason}`);
  setJobVariable(env, MODE_VARIABLE, verdict.mode);
  if (verdict.guardFailure) {
    console.log(`::error title=Selection guard::${verdict.guardFailure}`);
    return 1;
  }
  return 0;
}

/** For each commit, whether a `merge_group` run tested it, or null when that could not be read. */
async function queueRunsFor(chain, context, repo) {
  const runs = new Map();
  for (const sha of chain) {
    const page = await readOrNull(`repos/${repo}/actions/runs?head_sha=${sha}&event=merge_group&per_page=1`, context);
    runs.set(sha, page && typeof page.total_count === "number" ? page.total_count > 0 : null);
  }
  return runs;
}

async function tripwire(env, context, repo, before, after) {
  if ((env[SELECTION_SWITCH] ?? "") !== "on") {
    console.log(`merge-path: ${SELECTION_SWITCH} is not on, so a direct merge narrows nothing; not checked`);
    return 0;
  }
  const compare = await readOrNull(`repos/${repo}/compare/${before}...${after}?per_page=250`, context);
  const chain = compare && firstParentChain(compare.commits ?? [], before, after);
  if (!chain || chain.length === 0) {
    console.log(`::error title=Selection guard::could not tell which commits this push brought (${before}..${after}); check by hand that each came through the merge queue`);
    return 1;
  }
  const runs = await queueRunsFor(chain, context, repo);
  const direct = directMerges(chain, sha => runs.get(sha));
  if (direct === null) {
    console.log("::error title=Selection guard::could not read the merge-queue runs for every commit this push brought; check by hand");
    return 1;
  }
  console.log(`merge-path: ${chain.length} commit(s) checked, ${direct.length} without a merge-queue run`);
  for (const sha of direct) {
    console.log(`::error title=Selection guard::${sha} reached main without the merge queue, so a direct-merge path exists while ${SELECTION_SWITCH} is on. Switch it off.`);
  }
  return direct.length === 0 ? 0 : 1;
}

async function enablement(context, repo) {
  const branchRules = await readOrNull(`repos/${repo}/rules/branches/main`, context);
  if (!Array.isArray(branchRules)) {
    console.log("merge-path enablement: FAIL, main's rules could not be read");
    return 1;
  }
  const ids = [...new Set(branchRules.map(rule => rule.ruleset_id).filter(id => id !== undefined))];
  const rulesets = [];
  for (const id of ids) {
    const ruleset = await readOrNull(`repos/${repo}/rulesets/${id}`, context);
    rulesets.push(ruleset ?? { id, name: "unreadable", enforcement: "unknown" });
  }
  const problems = directPaths(rulesets, branchRules);
  console.log(`merge-path enablement: ${problems.length === 0 ? "PASS" : "FAIL"}, ${rulesets.length} ruleset(s) read for main`);
  for (const problem of problems) console.log(`  - ${problem}`);
  return problems.length === 0 ? 0 : 1;
}

export async function main(argv = process.argv.slice(2), env = process.env, { fetchImpl = fetch } = {}) {
  const repo = env.GITHUB_REPOSITORY ?? "nextlyhq/nextly";
  const context = { token: env.GH_TOKEN ?? env.GITHUB_TOKEN, fetchImpl };
  const [command, ...rest] = argv;
  if (command === "select") return select(env, context, repo);
  if (command === "tripwire" && rest.length === 2) return tripwire(env, context, repo, rest[0], rest[1]);
  if (command === "enablement") return enablement(context, repo);
  console.log("usage: merge-path.mjs select | tripwire <before> <after> | enablement");
  return 2;
}

if (isCliEntry(import.meta.url)) process.exit(await main());
