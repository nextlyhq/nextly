#!/usr/bin/env node
/**
 * Deletes the Actions caches pull requests hold that no run will read again,
 * on a schedule, so they stop holding the repository's cache allowance until
 * least-recently-used eviction reaches them (and `main`'s caches with them).
 * Three kinds, all under a pull request's merge ref (`refs/pull/<n>/merge`):
 *
 * - **A closed pull request's.** Its caches are deleted as it closes
 *   (`delete-closed-pull-request-caches.mjs`), but a run cancelled then can
 *   still finish an upload afterwards, and a pull request closed with a merge
 *   conflict starts no `pull_request` workflow at all. Every cache under a
 *   closed one's ref goes; one whose state cannot be read keeps its caches.
 * - **Superseded.** A job saves under a key ending in the commit or lockfile
 *   it ran on, and the next push of the same pull request saves the same
 *   family again under a new ending. A restore takes the newest by prefix, so
 *   every older key of a family on that ref is dead: only the newest is kept.
 * - **A copy of `main`'s.** A pull request restores `main`'s entries, so an
 *   entry under its own ref with a key `main` also holds is never read.
 *
 * 🔴 Nothing outside a pull request's merge ref is ever deleted: not `main`,
 * the merge queue, a tag, nor a ref this cannot read as a pull request's. A
 * key whose end is not a commit or a hash has no family here, and is kept.
 *
 * Usage, in a scheduled workflow step:
 *   node scripts/sweep-pull-request-caches.mjs
 * Reads GITHUB_REPOSITORY and GH_TOKEN.
 */
import { isCliEntry } from "./cli-entry.mjs";
import { githubJson, githubRequest } from "./github-api.mjs";
import { commandText } from "./workflow-context.mjs";

/** GitHub lists at most 100 caches a page; the repository's allowance holds far fewer than this many pages. */
const MAX_PAGES = 30;

/** Whether a ref is a pull request's merge ref, the only refs this deletes from. */
export function isPullRequestRef(ref) {
  return /^refs\/pull\/\d+\/merge$/.test(String(ref ?? ""));
}

/**
 * The family a key belongs to: the key without its last `-` segment, when
 * that segment is a commit SHA or a content hash (20 or more hex digits).
 * Null for any other key, which is then never taken as superseded.
 */
export function familyOf(key) {
  const match = /^(.+)-[0-9a-f]{20,}$/.exec(String(key ?? ""));
  return match ? match[1] : null;
}

/**
 * What to delete from a cache listing, each with its reason; everything else
 * is kept. `closed` are the merge refs of pull requests known to be closed:
 * all of their caches go. Of a family on an open pull request's ref the
 * newest by creation is kept, and an entry whose key `main` also holds goes
 * whatever its age.
 */
export function sweepPlan(caches, { closed = new Set() } = {}) {
  const mainKeys = new Set(caches.filter(cache => cache.ref === "refs/heads/main").map(cache => cache.key));
  const doomed = new Map();
  const families = new Map();
  for (const cache of caches.filter(entry => isPullRequestRef(entry.ref))) {
    if (closed.has(cache.ref)) {
      doomed.set(cache.id, { cache, reason: "a closed pull request's" });
      continue;
    }
    if (mainKeys.has(cache.key)) {
      doomed.set(cache.id, { cache, reason: "a copy of main's" });
      continue;
    }
    const family = familyOf(cache.key);
    if (family === null) continue;
    const group = `${cache.ref} ${family}`;
    families.set(group, [...(families.get(group) ?? []), cache]);
  }
  for (const group of families.values()) {
    const [, ...older] = [...group].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    for (const cache of older) doomed.set(cache.id, { cache, reason: "superseded" });
  }
  return [...doomed.values()];
}

/** Every cache in the repository, and whether the list came back shorter than GitHub's total. */
async function allCaches(repository, context) {
  const caches = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { total_count: count, actions_caches: items } = await githubJson(
      `repos/${repository}/actions/caches?per_page=100&page=${page}`,
      context
    );
    total = Math.max(total, count ?? 0);
    caches.push(...items);
    if (items.length < 100) break;
  }
  return { caches, short: caches.length < total };
}

/**
 * The merge refs, among those caches are held under, whose pull request is
 * closed. A pull request that cannot be read is left out, so its caches are
 * judged as an open one's: deleting is the direction that cannot be undone.
 */
async function closedRefs(caches, repository, context) {
  const refs = [...new Set(caches.map(cache => cache.ref).filter(isPullRequestRef))];
  const closed = new Set();
  for (const ref of refs) {
    const number = ref.split("/")[2];
    try {
      const pull = await githubJson(`repos/${repository}/pulls/${number}`, context);
      if (pull.state === "closed") closed.add(ref);
    } catch (error) {
      console.log(`sweep-pull-request-caches: #${number} could not be read (${error.message}); its caches are judged as open`);
    }
  }
  return closed;
}

/** Sweeps the repository's pull-request caches, and returns the exit code. */
export async function main(env = process.env, { fetchImpl = fetch } = {}) {
  const repository = env.GITHUB_REPOSITORY;
  const context = { token: env.GH_TOKEN, fetchImpl };
  try {
    const { caches, short } = await allCaches(repository, context);
    const plan = sweepPlan(caches, { closed: await closedRefs(caches, repository, context) });
    let freed = 0;
    const failed = [];
    for (const { cache, reason } of plan) {
      const response = await githubRequest(`repos/${repository}/actions/caches/${cache.id}`, context, "DELETE");
      // One already gone answers 404, which is the outcome wanted.
      const ok = response.ok || response.status === 404;
      if (ok) freed += cache.size_in_bytes ?? 0;
      else failed.push(cache.key);
      console.log(`sweep-pull-request-caches: ${cache.ref} ${cache.key} (${reason}): HTTP ${response.status}`);
    }
    const listed = caches.reduce((sum, cache) => sum + (cache.size_in_bytes ?? 0), 0);
    console.log(
      `sweep-pull-request-caches: ${plan.length} of ${caches.length} cache(s) deleted, ${(freed / 2 ** 20).toFixed(1)} MB of ${(listed / 2 ** 20).toFixed(1)} MB freed`
    );
    if (failed.length > 0) return refuse(`could not delete ${failed.length} cache(s): ${failed.join(", ")}`);
    return short ? refuse("swept what was listed, but the list was short, so a cache may remain") : 0;
  } catch (error) {
    return refuse(`could not read or delete the caches (${error.message})`);
  }
}

function refuse(problem) {
  console.log(`::error title=Sweep pull request caches::${commandText(problem)}`);
  return 1;
}

if (isCliEntry(import.meta.url)) process.exit(await main());
