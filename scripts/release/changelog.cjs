/**
 * Changelog entries built from LOCAL git, with no GitHub API call.
 *
 * `@changesets/changelog-github` asks GitHub for the pull request and author behind every
 * changeset. Its `get-github-info` loader batches with no `maxBatchSize`, so one query carries an
 * aliased `object(expression: <commit>)` per changeset, each with a nested
 * `associatedPullRequests(first: 50)`. Past a few hundred pending changesets GitHub stops
 * VALIDATING the document - `{"message": "Timeout on validation of query"}` - and the release
 * fails before writing anything. Validation is refused rather than the work being slow, so
 * retries and backoff do not reach it; the query has to stop being built.
 *
 * Everything those entries need is already in the repository. The squash subject a merge writes
 * carries its pull-request number, `changeset.commit` carries the revision, and both URLs are
 * constructed from the repo name. One `git log` pass over the whole history builds the map, so
 * the cost does not grow with the number of changesets and no network is involved.
 *
 * The trade against `@changesets/changelog-github` is author attribution: a git author is not a
 * GitHub login, and guessing one from a name or an email would be a fabricated link. Attribution
 * is dropped rather than approximated.
 */

const { execFileSync } = require("node:child_process");

/**
 * The two subject shapes that name a pull request unambiguously.
 *
 * A squash merge writes `feat(scope): subject (#1234)`; a merge commit writes
 * `Merge pull request #1234 from owner/branch`. Both identify the pull request in the commit
 * itself, so neither can attribute an entry to the wrong one.
 *
 * A commit arriving by neither route gets a commit link and no pull-request link. That is a
 * deliberate miss: 118 of 560 changeset-adding commits in this history carry no reference at all,
 * in the subject or the body, and the only way to reach one is to walk forward to an enclosing
 * merge. Measured on three of them, that walk answers correctly once, lands on a
 * `Merge remote-tracking branch` sync commit once, and finds nothing once - so it would sometimes
 * name a pull request the change did not come from. A wrong link is worse than an absent one, for
 * the same reason the author is dropped rather than guessed from a git identity.
 */
const PULL_REQUEST_PATTERNS = [
  // Anchored to the END: `(#12)` mid-sentence is prose about an issue, not this merge's number.
  /\(#(\d+)\)\s*$/,
  /^Merge pull request #(\d+)\b/,
];

/**
 * Read every commit once, rather than per changeset.
 *
 * A lookup per entry would be several hundred subprocesses on a backlog this size. This is one,
 * and its result is reused for every line in the run.
 *
 * Resolved lazily so that importing this module cannot fail: `changeset version` runs in trees
 * where git may be absent or the history shallow, and a changelog is not worth aborting a release
 * over. A failed read yields an empty map, which degrades every entry to its summary alone.
 */
let subjectsByCommit;

function commitSubjects() {
  if (subjectsByCommit) return subjectsByCommit;
  subjectsByCommit = new Map();
  try {
    const log = execFileSync("git", ["log", "--format=%H%x09%s"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    for (const line of log.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      subjectsByCommit.set(line.slice(0, tab), line.slice(tab + 1));
    }
  } catch {
    // Left empty on purpose. The caller cannot tell "no such commit" from "no git", and both
    // resolve the same way: emit the summary without links rather than fail the release.
  }
  return subjectsByCommit;
}

/**
 * The pull request a commit landed through, or null when the subject does not name one.
 *
 * Null is the correct answer for a direct push and for a commit this checkout does not have. It is
 * not an error: an entry without a link is still a correct changelog entry.
 */
function pullRequestFor(commit, subjects = commitSubjects()) {
  if (!commit) return null;
  const subject = subjects.get(commit);
  if (!subject) return null;
  for (const pattern of PULL_REQUEST_PATTERNS) {
    const match = pattern.exec(subject);
    if (match) return match[1];
  }
  return null;
}

/** One release line. Exported so its formatting is testable without running a release. */
function releaseLine(changeset, repo, subjects = commitSubjects()) {
  const [first, ...rest] = changeset.summary.split("\n").map(line => line.trimEnd());

  const links = [];
  if (changeset.commit) {
    const short = changeset.commit.slice(0, 7);
    links.push(`[\`${short}\`](https://github.com/${repo}/commit/${changeset.commit})`);
    const pull = pullRequestFor(changeset.commit, subjects);
    if (pull) links.push(`[#${pull}](https://github.com/${repo}/pull/${pull})`);
  }

  const prefix = links.length > 0 ? `${links.join(" ")} - ` : "";
  let line = `- ${prefix}${first}`;
  // A multi-line summary keeps its shape, indented under the bullet, as changelog-git does.
  if (rest.length > 0) line += `\n${rest.map(one => `  ${one}`).join("\n")}`;
  return line;
}

const changelogFunctions = {
  getReleaseLine: async (changeset, _type, options) =>
    releaseLine(changeset, options?.repo ?? "nextlyhq/nextly"),

  getDependencyReleaseLine: async (changesets, dependenciesUpdated, options) => {
    if (dependenciesUpdated.length === 0) return "";
    const repo = options?.repo ?? "nextlyhq/nextly";
    const subjects = commitSubjects();
    // ONE bullet, with the commits inline and the packages nested under it.
    //
    // A bullet per changeset followed by a single package list reads correctly in source and
    // renders wrongly: Markdown attaches the nested list to the LAST bullet, so every earlier
    // changeset becomes an empty `Updated dependencies` line and the package versions appear to
    // belong to whichever commit happened to sort last. With a lockstep release group every
    // changeset touches every package, so that is not a corner case - it is the normal shape, and
    // at this repository's backlog it produces dozens of empty bullets per package.
    const links = changesets
      .filter(changeset => changeset.commit)
      .map(changeset => {
        const short = changeset.commit.slice(0, 7);
        const pull = pullRequestFor(changeset.commit, subjects);
        const commitLink = `[\`${short}\`](https://github.com/${repo}/commit/${changeset.commit})`;
        return pull
          ? `${commitLink} [#${pull}](https://github.com/${repo}/pull/${pull})`
          : commitLink;
      });
    const heading = links.length > 0 ? `- Updated dependencies ${links.join(", ")}` : "- Updated dependencies";
    const packages = dependenciesUpdated.map(one => `  - ${one.name}@${one.newVersion}`);
    return [heading, ...packages].join("\n");
  },
};

// CommonJS on purpose. `apply-release-plan` loads this with `require()`, which cannot read an
// ESM `.mjs` on Node 20 - a version this repository still supports - so the module format is
// decided by the consumer rather than by the surrounding convention.
//
// `default` as well as the bare shape: the loader accepts either, and pinning both means a change
// to its interop cannot silently fall through to an undefined function.
module.exports = changelogFunctions;
module.exports.default = changelogFunctions;
module.exports.pullRequestFor = pullRequestFor;
module.exports.releaseLine = releaseLine;
