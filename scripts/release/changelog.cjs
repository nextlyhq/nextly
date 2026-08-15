/**
 * `@changesets/changelog-github`, with its GitHub lookups memoised and issued one at a time.
 *
 * Every entry is produced by the upstream generator, which this module delegates to rather than
 * reimplements, so the pull-request link and the `Thanks [@user]` attribution are unchanged. Only
 * HOW the lookups reach GitHub is different.
 *
 * Two properties of the release path combine into the failure this avoids:
 *
 * - `apply-release-plan` calls `getReleaseLine` for every changeset of every package in one
 *   synchronous loop. This repository releases as a fixed lockstep group, so every changeset
 *   touches every package and the loop is packages x changesets - over a thousand lookups, all
 *   started in the same tick.
 * - `get-github-info` batches with a `DataLoader` that declares no `maxBatchSize`, so that whole
 *   set becomes ONE GraphQL document with an aliased `object(expression: <commit>)` per lookup,
 *   each carrying a nested `associatedPullRequests(first: 50)`. GitHub stops VALIDATING it -
 *   `{"message": "Timeout on validation of query"}` - and the release fails before writing
 *   anything. Validation is refused rather than the work being slow, so retries never reach it.
 *
 * `DataLoader` would normally collapse the repeats, and here it cannot: `load()` is handed a
 * freshly built object every call, so the cache key is never `===` to a previous one. Measured,
 * four identical `getInfo` calls each cost a full round trip (730ms, 517ms, 553ms, 531ms) - there
 * is no second-call discount to rely on.
 *
 * So this wraps `getInfo` with a cache of its own, keyed by repo and commit, and lets one lookup
 * run at a time. The thousand-odd calls collapse to one per distinct commit, and each is alone in
 * its tick, so every batch holds a single alias. The wrap works because the generator reaches its
 * dependency through a namespace property at CALL time rather than capturing the function at
 * import, so replacing the property is enough and no patching of internals is involved.
 */

const getGithubInfo = require("@changesets/get-github-info");
const changelogGithub = require("@changesets/changelog-github").default;

/**
 * One in-flight lookup at a time.
 *
 * A promise chain rather than a concurrency limiter, because the property needed is not "few at
 * once" but "alone in its tick" - that is what makes a `DataLoader` batch hold a single key.
 *
 * The chain absorbs rejections so one failed lookup cannot strand every later one. The rejection
 * still reaches the caller through the returned promise; only the CHAIN is protected.
 */
let chain = Promise.resolve();

function oneAtATime(work) {
  const result = chain.then(work, work);
  chain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * Results by repo and commit.
 *
 * The PROMISE is stored rather than the resolved value, so concurrent callers asking for the same
 * commit share one lookup instead of queueing a second behind it.
 *
 * A rejection is evicted. Caching one would turn a single transient failure into a permanent hole
 * in the changelog for that commit, for the rest of the run.
 */
const byCommit = new Map();
const byPullRequest = new Map();

/**
 * The real implementations, captured before the properties are replaced.
 *
 * Held in one object so a test can substitute them without a live GitHub request. Assigning the
 * wrapper first and reading the property back inside it would recurse instead.
 */
const upstream = {
  getInfo: getGithubInfo.getInfo,
  getInfoFromPullRequest: getGithubInfo.getInfoFromPullRequest,
};

function memoise(cache, keyOf, call) {
  return request => {
    const key = keyOf(request);
    const existing = cache.get(key);
    if (existing) return existing;

    const pending = oneAtATime(() => call(request)).catch(error => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
    return pending;
  };
}

const cachedGetInfo = memoise(
  byCommit,
  request => `${request.repo}\u0000${request.commit}`,
  request => upstream.getInfo(request)
);

/**
 * The other door into the same API.
 *
 * A changeset summary may carry `pr: #123`, and the generator then calls
 * `getInfoFromPullRequest` instead of `getInfo`. Wrapping only one leaves those lookups
 * unbatched and unmemoised, which is the same oversized document arriving by a route nobody
 * looked at.
 */
const cachedGetInfoFromPullRequest = memoise(
  byPullRequest,
  request => `${request.repo}\u0000${request.pull}`,
  request => upstream.getInfoFromPullRequest(request)
);

getGithubInfo.getInfo = cachedGetInfo;
getGithubInfo.getInfoFromPullRequest = cachedGetInfoFromPullRequest;

const changelogFunctions = {
  getReleaseLine: (changeset, type, options) =>
    changelogGithub.getReleaseLine(changeset, type, options),
  getDependencyReleaseLine: (changesets, dependenciesUpdated, options) =>
    changelogGithub.getDependencyReleaseLine(changesets, dependenciesUpdated, options),
};

module.exports = changelogFunctions;
module.exports.default = changelogFunctions;
module.exports.oneAtATime = oneAtATime;
module.exports.cachedGetInfo = cachedGetInfo;
module.exports.cachedGetInfoFromPullRequest = cachedGetInfoFromPullRequest;
module.exports.byCommit = byCommit;
module.exports.byPullRequest = byPullRequest;
module.exports.upstream = upstream;
