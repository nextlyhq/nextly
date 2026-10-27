#!/usr/bin/env node
/**
 * Deletes the Actions caches a pull request's own runs saved, once it has been
 * merged or closed.
 *
 * A pull request's runs save under its merge ref (`refs/pull/<n>/merge`), and
 * a cache there is read only by later runs of that same pull request: another
 * pull request reads its own ref and `main`'s, never this one. Once it is
 * closed, nothing reads them again, yet they count against the repository's
 * cache allowance until least-recently-used eviction reaches them, and
 * eviction does not know which entries are dead: it removes `main`'s pnpm
 * store or Playwright browsers as readily. So they are deleted here, as the
 * pull request closes.
 *
 * Only a cache whose ref is exactly that pull request's merge ref is deleted:
 * never one of `main`, the merge queue, a tag or another pull request.
 *
 * Usage, in a workflow step on `pull_request: closed`:
 *   node scripts/delete-closed-pull-request-caches.mjs
 * Reads GITHUB_EVENT_PATH, GITHUB_REPOSITORY and GH_TOKEN.
 */
import { isCliEntry } from "./cli-entry.mjs";
import { githubJson, githubRequest } from "./github-api.mjs";
import { commandText, eventPayload } from "./workflow-context.mjs";

/** The ref a pull request's own runs save their caches under. */
export function mergeRefOf(number) {
  return `refs/pull/${number}/merge`;
}

/** GitHub lists at most 100 caches a page; ten pages covers far more than one pull request holds. */
const MAX_PAGES = 10;

/**
 * Every cache listed under `ref`, read to its last page, and whether the list
 * came back shorter than GitHub's total for it. A short list is reported,
 * never taken as whole: the caches it does hold are still deleted.
 */
async function cachesUnder(repository, ref, context) {
  const caches = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { total_count: count, actions_caches: items } = await githubJson(
      `repos/${repository}/actions/caches?ref=${encodeURIComponent(ref)}&per_page=100&page=${page}`,
      context
    );
    total = Math.max(total, count ?? 0);
    caches.push(...items);
    if (items.length < 100) break;
  }
  return { caches, short: caches.length < total };
}

/**
 * The caches that are this pull request's to delete: those whose ref is
 * exactly its merge ref. The listing is already filtered by ref; this holds
 * the deletion to it whatever the listing returns.
 */
export function cachesOf(number, caches) {
  const ref = mergeRefOf(number);
  return caches.filter(cache => cache?.ref === ref);
}

/**
 * Deletes each cache, and returns how each went. One already gone answers
 * 404, which is the outcome wanted, not a failure.
 */
export async function deleteAll(caches, repository, context) {
  const outcomes = [];
  for (const cache of caches) {
    const response = await githubRequest(`repos/${repository}/actions/caches/${cache.id}`, context, "DELETE");
    outcomes.push({
      id: cache.id,
      key: cache.key,
      bytes: cache.size_in_bytes ?? 0,
      status: response.status,
      ok: response.ok || response.status === 404,
    });
  }
  return outcomes;
}

/** Deletes the closed pull request's caches, and returns the exit code. */
export async function main(env = process.env, { fetchImpl = fetch } = {}) {
  const pull = eventPayload(env).pull_request;
  if (!pull?.number) return refuse("the event names no pull request");
  const context = { token: env.GH_TOKEN, fetchImpl };
  const repository = env.GITHUB_REPOSITORY;
  try {
    // This run can wait in the queue long after the close. If its pull
    // request was reopened meanwhile, its caches are wanted again.
    const now = await githubJson(`repos/${repository}/pulls/${pull.number}`, context);
    if (now.state === "open") {
      console.log(`delete-closed-pull-request-caches: #${pull.number} is open again; nothing deleted`);
      return 0;
    }
    const { caches, short } = await cachesUnder(repository, mergeRefOf(pull.number), context);
    const outcomes = await deleteAll(cachesOf(pull.number, caches), repository, context);
    const freed = outcomes.filter(outcome => outcome.ok).reduce((sum, outcome) => sum + outcome.bytes, 0);
    for (const outcome of outcomes) console.log(`delete-closed-pull-request-caches: ${outcome.key}: HTTP ${outcome.status}`);
    console.log(`delete-closed-pull-request-caches: #${pull.number}: ${outcomes.length} cache(s), ${(freed / 2 ** 20).toFixed(1)} MB freed`);
    const failed = outcomes.filter(outcome => !outcome.ok);
    if (failed.length > 0) return refuse(`could not delete ${failed.length} cache(s): ${failed.map(outcome => outcome.key).join(", ")}`);
    return short ? refuse("deleted what was listed, but the list was short, so a cache may remain") : 0;
  } catch (error) {
    return refuse(`could not read or delete #${pull.number}'s caches (${error.message})`);
  }
}

function refuse(problem) {
  console.log(`::error title=Delete closed pull request caches::${commandText(problem)}`);
  return 1;
}

if (isCliEntry(import.meta.url)) process.exit(await main());
