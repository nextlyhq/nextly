/**
 * Decides whether a pull request may merge, and whether a merged one landed
 * whole.
 *
 * `.claude/rules/verifying-merged-work.md` describes the same procedure in
 * prose with runnable shell in it. Shell embedded in a document has nothing
 * executing it, and every way it can be wrong here looks like a pass: a count
 * computed and never read, an exit status swallowed by a pipeline, a comparison
 * against a base that moves. A gate whose failure mode is a false clean has to
 * be the kind of thing a test can hold inputs against.
 *
 * So the decisions live here as pure functions, and every I/O call stays in the
 * caller: a function that fetches cannot be handed the case it must get right.
 */

/**
 * Timeline events that replace a branch's history.
 *
 * A force-push, a deletion, and a deletion followed by recreation all leave the
 * branch reading as ordinary while the commits that were on it are gone. The
 * range check then compares a head against itself and reports nothing missing,
 * which is indistinguishable from a branch that never had a tail.
 *
 * The list is a FLOOR rather than a proof. A mutable remote ref observed over
 * several round trips cannot support "no commit ever existed here outside the
 * merge", so this exists to disqualify the cases we know of, not to certify the
 * rest.
 */
/** A git object name in full. Anything shorter is an abbreviation. */
export const FULL_SHA_LENGTH = 40;

export const HISTORY_REWRITE_EVENTS = Object.freeze([
  "head_ref_force_pushed",
  "head_ref_deleted",
  "head_ref_restored",
]);

/**
 * Total history-rewrite events across every page of a timeline.
 *
 * Takes the pages rather than fetching them, and takes them as already-parsed
 * arrays: the GitHub timeline is paged at 100 and long pull requests here reach
 * three pages, so a caller that reads only the first gets zero — the
 * reassuring answer — for a branch whose history was rewritten on page two.
 */
export function countRewriteEvents(pages) {
  if (!Array.isArray(pages)) {
    throw new TypeError("countRewriteEvents needs an array of timeline pages");
  }
  // A page that is not an array is a page that was not read. `[events, null]`
  // survives the check above, `flat()` carries the bad value through, and the
  // optional access then ignores it — so a partly unreadable timeline counts
  // zero rewrites and reports the branch as checkable. That is the exact
  // direction this module exists to refuse.
  for (const page of pages) {
    if (!Array.isArray(page)) {
      throw new TypeError("countRewriteEvents needs every page to be an array");
    }
  }
  return pages
    .flat()
    .filter(event => HISTORY_REWRITE_EVENTS.includes(event?.event)).length;
}

/**
 * Whether the branch can answer "did every commit land" at all.
 *
 * Returns a REASON rather than a boolean, because every caller so far has
 * wanted to print why. Collapsing it to a boolean is how "I could not look"
 * becomes "nothing to see", which is the failure this whole file exists to
 * separate.
 */
export function checkability({ tip, rewriteEvents }) {
  if (typeof tip !== "string" || tip.length === 0) {
    // An absent tip has three causes and only one is genuinely unanswerable:
    // the branch was deleted, the pull request came from a fork whose branch
    // was never on this remote, or the name given did not resolve. A name typed
    // from memory produces this as readily as a deletion, and did.
    return { checkable: false, reason: "no-ref" };
  }
  if (!Number.isInteger(rewriteEvents) || rewriteEvents < 0) {
    // Unreadable is not zero. A failed timeline query that degrades to 0 turns
    // the guard off exactly when it cannot see.
    return { checkable: false, reason: "rewrite-count-unknown" };
  }
  if (rewriteEvents > 0) {
    return { checkable: false, reason: "history-rewritten" };
  }
  return { checkable: true, reason: "ok" };
}

/**
 * A check-run's conclusion, reduced to whether it may be counted as passing.
 *
 * `skipped` passes because a job skipped by a condition is how this repository
 * expresses "this commit cannot affect me". `neutral` passes for the same
 * reason: GitHub accepts both for a required status check, so refusing them
 * would make this gate stricter than the protection it claims to model and
 * block a revision the platform considers mergeable.
 * Everything else that is not `success` does NOT pass — including `queued` and
 * `in_progress`, which are the ones that get miscounted: filtering for
 * `conclusion === "failure"` and finding none reads as green while nothing has
 * run. One merge commit here had four required jobs queued for hours and two
 * unrelated ones completed, and answered zero failures throughout.
 */
const PASSING_CONCLUSIONS = Object.freeze(["success", "skipped", "neutral"]);

export function jobPasses(run) {
  return PASSING_CONCLUSIONS.includes(run?.conclusion);
}

/**
 * The jobs standing between a revision and a merge, named rather than counted.
 *
 * A count cannot be acted on. "3 not green" sends the reader to the web UI;
 * a name tells them whether it is theirs, which is the difference between
 * attributing a red and inheriting one.
 */
export function blockingJobs(checkRuns) {
  if (!Array.isArray(checkRuns)) {
    throw new TypeError("blockingJobs needs an array of check-runs");
  }
  return checkRuns
    .filter(run => !jobPasses(run))
    .map(run => ({
      name: run?.name ?? "(unnamed)",
      status: run?.status ?? "unknown",
      conclusion: run?.conclusion ?? null,
    }));
}

/**
 * Whether a review verdict belongs to the revision being merged.
 *
 * A verdict describes the tree it read. Carried forward to a later push it is
 * an opinion about a revision nobody is merging, and it reads exactly like an
 * opinion about this one. Compared by prefix because the bots report a short
 * sha and the ref reports a full one.
 */
export function verdictCoversTip(reviewedSha, tip) {
  if (typeof reviewedSha !== "string" || reviewedSha.length === 0) return false;
  if (typeof tip !== "string" || tip.length === 0) return false;
  // Deliberately ASYMMETRIC. The bot reports an abbreviated sha and the ref
  // reports a full one, so only the VERDICT may be short. A symmetric
  // comparison accepts a TRUNCATED tip whenever it prefixes a full reviewed
  // sha, which would let the gate pass without ever identifying the head
  // revision — the one thing it exists to pin.
  if (tip.length < FULL_SHA_LENGTH) return false;
  // Seven is git's own floor for an abbreviation that identifies a commit.
  if (reviewedSha.length < 7 || reviewedSha.length > tip.length) return false;
  return tip.startsWith(reviewedSha);
}

/**
 * Whether a reviewer looked at all, kept separate from what it found.
 *
 * Zero findings and zero reviews render identically in every count-based gate,
 * and one of them means nothing was checked. This repository's second reviewer
 * runs on a per-developer quota shared by every concurrent session, so it
 * silently stops reviewing under exactly the conditions that produce the most
 * pull requests.
 */
export function reviewCoverage(reviewCount) {
  if (!Number.isInteger(reviewCount) || reviewCount < 0) return "unknown";
  return reviewCount === 0 ? "not-reviewed" : "reviewed";
}

/**
 * The merge gate: every blocker, or an empty list.
 *
 * Returns them all rather than the first, so one round of fixing clears the
 * gate instead of revealing the next reason a merge was never going to happen.
 */
export function gateVerdict({
  tip,
  unresolvedThreads,
  checkRuns,
  changedPaths,
  required,
  codexReviewedSha,
  coderabbitReviewCount,
}) {
  const blockers = [];

  if (typeof tip !== "string" || tip.length === 0) {
    blockers.push({ kind: "no-tip", detail: "no head revision to merge" });
  }

  if (!Number.isInteger(unresolvedThreads) || unresolvedThreads < 0) {
    // Unknown is not zero, for the same reason everywhere else in this file.
    blockers.push({
      kind: "threads-unknown",
      detail: "could not read review threads",
    });
  } else if (unresolvedThreads > 0) {
    blockers.push({
      kind: "unresolved-threads",
      detail: `${unresolvedThreads} unresolved review thread(s)`,
    });
  }

  if (!Array.isArray(checkRuns)) {
    blockers.push({
      kind: "checks-unknown",
      detail: "could not read check-runs",
    });
  } else if (checkRuns.length === 0) {
    // No jobs at all is not a pass. It is the shape of a run that never
    // started, and a pull request has merged here in exactly that state.
    blockers.push({
      kind: "no-checks",
      detail: "no check-runs reported for this revision",
    });
  } else {
    for (const name of missingRequired(checkRuns, changedPaths, required)) {
      blockers.push({
        kind: "required-check-absent",
        detail: `${name} never reported — no build or test coverage for this revision`,
      });
    }
    for (const job of blockingJobs(checkRuns)) {
      blockers.push({
        kind: "job-not-green",
        detail: `${job.name} (${job.status}/${job.conclusion ?? "-"})`,
      });
    }
  }

  if (!verdictCoversTip(codexReviewedSha, tip)) {
    blockers.push({
      kind: "verdict-stale",
      detail: `no review verdict for ${typeof tip === "string" ? tip.slice(0, 9) : "(unknown)"}`,
    });
  }

  return {
    mergeable: blockers.length === 0,
    blockers,
    // Reported, never a blocker. The project's decision is to run with one
    // reviewer and know it, rather than to treat its silence as coverage.
    secondReviewer: reviewCoverage(coderabbitReviewCount),
  };
}

/** Human-readable gate result, for a caller that prints rather than branches. */
export function formatVerdict(verdict) {
  const lines = [];
  lines.push(verdict.mergeable ? "GATE PASSED" : "GATE BLOCKED");
  for (const blocker of verdict.blockers)
    lines.push(`  - ${blocker.kind}: ${blocker.detail}`);
  if (verdict.secondReviewer !== "reviewed") {
    lines.push(
      `  ! second reviewer: ${verdict.secondReviewer} (not a blocker; not coverage either)`
    );
  }
  return lines.join("\n");
}

/**
 * The process exit status, as a decision rather than as control flow.
 *
 * Kept here with the other decisions because the caller's `return` statements
 * are the one part of a gate nothing can hand inputs to, and this gate's
 * failures are all false cleans — the exact thing an untested branch produces.
 *
 * 0 passed, 1 blocked, 2 unsettled. The third is not a softer version of the
 * second: a caller may reasonably retry or escalate an unsettled result, and
 * must never treat it as a pass.
 */
/**
 * A git remote URL reduced to `owner/repo`, or null when it names no repository.
 *
 * Compared structurally rather than by string equality because one repository
 * has several spellings — `https://`, `git@`, `ssh://`, with or without `.git`,
 * with or without a trailing slash — and a check that misses a spelling falls
 * back to a remote that may be a different repository entirely.
 */
export function repoFromRemoteUrl(url) {
  if (typeof url !== "string") return null;
  const match =
    /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(
      url.trim()
    );
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * The remote to read a pull request's head from.
 *
 * The head repository comes from the pull request, never from an assumption
 * about `origin`. Running from a fork checkout, `origin` is the fork, so a pull
 * request whose head lives in the upstream repository would resolve against a
 * same-named branch on the fork — a real, unrelated revision, whose checks and
 * reviews this gate would then report as the pull request's.
 *
 * A local remote is preferred only when it IS that repository, so configured
 * credentials and transports keep working; otherwise the canonical URL, which
 * is correct everywhere and needs no local setup.
 */
export function remoteForRepo(repoFullName, remotes) {
  if (typeof repoFullName !== "string" || repoFullName === "") return null;
  const wanted = repoFullName.toLowerCase();
  for (const [name, url] of remotes ?? []) {
    if (repoFromRemoteUrl(url)?.toLowerCase() === wanted) return name;
  }
  return `https://github.com/${repoFullName}.git`;
}

/**
 * Whether the verdict still describes the pull request that was examined.
 *
 * Everything the gate reads is taken across many round trips and keyed to the
 * revision AND the mode observed at the start. Two things can move underneath
 * that, and only one of them is a revision:
 *
 * - the branch gains a commit, so the answers describe a revision it no longer
 *   has;
 * - the pull request MERGES, which usually leaves the tip untouched — so a tip
 *   comparison alone passes while every answer was taken in the pre-merge mode,
 *   judging the branch head with the landed-whole question never asked.
 *
 * Returns a reason rather than a boolean so the caller can say which moved.
 * Deliberately reports staleness only: adopting the new values would rubber
 * stamp exactly the unverified state this detects.
 */
export function staleVerification({
  mergedAtStart,
  mergedNow,
  tipAtStart,
  tipNow,
}) {
  if (mergedAtStart !== mergedNow) {
    return mergedNow ? "merged-during-verification" : "unmerged-during-verification";
  }
  if (tipAtStart !== tipNow) return "head-moved";
  return null;
}

export function exitCode({ landedVerdict, mergeable }) {
  // Read from the landed-whole verdict alone rather than from reachability as
  // well. Reachability answers whether a BRANCH could be compared against a
  // merge, which is not a question an open pull request has: taking it directly
  // made every open branch with a force-push in its history exit 2, hiding a
  // perfectly good BLOCKED verdict behind "could not answer". `landedWhole`
  // already folds reachability in, and reports `n/a` before there is a merge.
  if (landedVerdict === "not-checkable") return 2;
  if (landedVerdict === "candidates") return 2;
  return mergeable ? 0 : 1;
}

/**
 * Slurped pages, refused unless every one of them was actually read.
 *
 * `--paginate --slurp` yields an array of pages, and a page that failed arrives
 * as `null` rather than as an error. `flat()` carries that through and the
 * optional access downstream discards it, so a partly-unread response becomes a
 * SHORTER list that looks complete: fewer changed files can turn a source change
 * into a documentation-only one and excuse every integration check.
 */
export function flatPages(pages, label) {
  if (!Array.isArray(pages)) {
    throw new TypeError(`${label}: expected an array of pages`);
  }
  for (const page of pages) {
    if (page === null || typeof page !== "object") {
      throw new TypeError(`${label}: a page could not be read`);
    }
  }
  return pages;
}

/**
 * A commit STATUS, expressed as a check-run so one rule judges both.
 *
 * GitHub has two independent surfaces and a gate that reads one sees a partial
 * picture: `amannn/action-semantic-pull-request` and CodeRabbit both report
 * through the statuses API, so a check-runs-only query calls a revision green
 * while the title check is failing. Normalising here means `jobPasses` stays
 * the single definition of passing rather than growing a second one.
 */
export function statusAsRun(status) {
  const state = status?.state;
  return {
    name: status?.context ?? "(unnamed status)",
    status: state === "pending" ? "in_progress" : "completed",
    // Only `success` maps to a passing conclusion; `pending`, `failure` and
    // `error` all keep a value `jobPasses` refuses.
    conclusion: state === "success" ? "success" : (state ?? null),
  };
}

/**
 * Checks that were expected and never reported at all.
 *
 * A non-empty list of check-runs is not evidence that CI ran. The workflows
 * here are independent, so a run where `ci.yml` never created its jobs while
 * `secret-scan.yml` succeeded produces a green-looking set containing no build
 * and no tests. Absence of the expected name is the only thing that separates
 * them, and absence is invisible to any filter over what IS present.
 */
export function missingRequired(checkRuns, changedPaths, required) {
  if (!Array.isArray(required)) {
    throw new TypeError("missingRequired needs the required-check list");
  }
  if (!Array.isArray(checkRuns)) {
    throw new TypeError("missingRequired needs an array of check-runs");
  }
  const present = new Set(checkRuns.map(run => run?.name));
  return required
    .filter(check => workflowApplies(check.pathsIgnore, changedPaths))
    .map(check => check.name)
    .filter(name => !present.has(name));
}

/**
 * One segment of a workflow path filter, as a regular expression source.
 *
 * `**` spans directory separators and `*` stops at one, which is what makes
 * `**​/*.md` and `*.md` different patterns rather than spellings of each other.
 */
function globSegmentSource(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        // `**/` spans zero OR MORE directories, so `**/*.md` matches a root
        // README as well as a nested one. Requiring the separator made the gate
        // demand integration checks the workflow deliberately never created,
        // which does not merely over-require: those checks can never appear, so
        // a documentation-only pull request could never pass at all.
        if (glob[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return source;
}

/** Whether one changed file is covered by one workflow path filter. */
export function pathMatches(glob, path) {
  if (typeof glob !== "string" || typeof path !== "string") return false;
  return new RegExp(`^${globSegmentSource(glob)}$`).test(path);
}

/**
 * Whether a workflow filtered by `paths-ignore` runs for this change set.
 *
 * GitHub skips such a workflow only when EVERY changed file matches a pattern,
 * so one unmatched file is enough to make it run — and therefore enough to make
 * its absence from the check-runs a finding rather than an expected quiet.
 *
 * Unreadable input answers `true`. The whole purpose of the caller is to notice
 * a check that never reported, so an unknown change set must require the check
 * and be argued with, rather than excuse it and be believed.
 */
export function workflowApplies(pathsIgnore, changedPaths) {
  if (!Array.isArray(pathsIgnore) || pathsIgnore.length === 0) return true;
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return true;
  return changedPaths.some(
    path => !pathsIgnore.some(glob => pathMatches(glob, path))
  );
}

/**
 * `integration.yml`'s `paths-ignore`, which decides whether it runs at all.
 *
 * It filters at the TRIGGER, so on a change set it ignores the workflow creates
 * no check-runs whatsoever. That is the opposite of `ci.yml`, which runs always
 * and decides inertness in a job — leaving a `skipped` check-run behind, which
 * is a report. Absence and skipped look the same to a reader and only one of
 * them is evidence.
 *
 * Mirrored rather than parsed, and pinned by a test that reads the workflow, so
 * that editing the workflow fails CI here instead of silently widening what
 * this gate will pass.
 */
/**
 * The `paths-ignore` globs a workflow declares under one trigger.
 *
 * The gate reads the workflow itself rather than holding a copy of its filter.
 * A copy is a second implementation of the same question: it agrees on the day
 * it is written, and afterwards the workflow can be edited while the copy keeps
 * looking correct, at which point the gate waits for a check that will never
 * report or excuses one that should have.
 *
 * The TRIGGER matters and is not interchangeable. Before a merge the checks come
 * from the `pull_request` run; after one they come from `push` to the base
 * branch, and the two blocks are edited independently. Reading whichever is
 * nearest would answer about the wrong run.
 */
export function workflowPathsIgnore(workflowText, trigger) {
  if (typeof workflowText !== "string" || typeof trigger !== "string") {
    throw new TypeError("workflowPathsIgnore needs the workflow text and a trigger");
  }
  const lines = workflowText.split("\n");
  const start = lines.findIndex(line => line.trimEnd() === `  ${trigger}:`);
  if (start === -1) return [];

  const globs = [];
  let collecting = false;
  for (const line of lines.slice(start + 1)) {
    // Any line at the trigger's own indent or shallower ends the block, so a
    // filter belonging to the NEXT trigger is never read as this one's.
    if (/^ {0,2}\S/.test(line)) break;
    if (line.trim() === "paths-ignore:") {
      collecting = true;
      continue;
    }
    if (!collecting) continue;
    const entry = /^\s*-\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (!entry) break;
    globs.push(entry[1]);
  }
  return globs;
}

/**
 * Checks whose absence means the revision has no coverage, not that it is
 * clean, each with the filter deciding whether it was due to report.
 */
export function requiredChecks(integrationPathsIgnore) {
  return [
    // Every other job in `ci.yml` hangs off this one through `needs: [ci]`, so
    // if it never reported then the browser, scaffold and dev-script jobs did
    // not run either, however many unrelated workflows went green. `ci.yml`
    // filters in a job rather than at the trigger, so it always reports.
    { name: "Lint / Typecheck / Test / Build", pathsIgnore: [] },
    // Its own workflow, unfiltered, on every pull request.
    { name: "gitleaks", pathsIgnore: [] },
    // The only coverage any dialect-specific behaviour has: the unit suites
    // mock the drivers and the browser tests run on sqlite alone.
    { name: "Integration (postgres)", pathsIgnore: integrationPathsIgnore },
    { name: "Integration (mysql)", pathsIgnore: integrationPathsIgnore },
    { name: "Integration (sqlite)", pathsIgnore: integrationPathsIgnore },
  ];
}


/**
 * Reviews that examined THIS revision, by the record's own `commit_id`.
 *
 * A review describes the tree it read. Counting one written against an earlier
 * revision reports a reviewer as having covered a commit it never saw — the
 * same staleness the verdict check refuses, applied to coverage rather than to
 * findings.
 */
export function reviewsCoveringTip(reviews, tip, login) {
  if (!Array.isArray(reviews)) {
    throw new TypeError("reviewsCoveringTip needs an array of reviews");
  }
  if (typeof tip !== "string" || tip.length < FULL_SHA_LENGTH) return [];
  return reviews.filter(r => r?.user?.login === login && r?.commit_id === tip);
}

/**
 * Whether the merge took everything the branch had.
 *
 * Takes the candidate commits rather than running git, so the interesting
 * cases can be handed to it. `checkable` comes from {@link checkability}: a
 * branch whose history was rewritten, or whose ref does not resolve, cannot
 * answer this at all — and an empty candidate list from an unanswerable branch
 * is not evidence of anything.
 */
export function landedWhole({ checkable, reason, candidates }) {
  if (!checkable) return { verdict: "not-checkable", reason, candidates: [] };
  if (!Array.isArray(candidates)) {
    throw new TypeError("landedWhole needs an array of candidate commits");
  }
  if (candidates.length === 0) {
    return { verdict: "no-candidates", reason: "ok", candidates: [] };
  }
  // Deliberately NOT "lost". The range says only "absent from the merged
  // head", and a surviving branch also collects force-pushes, rebases and
  // follow-up work. Each named commit is worth confirming by content against
  // the merge commit; the screen produces the list, never the verdict.
  return { verdict: "candidates", reason: "absent-from-merge", candidates };
}

// ---------------------------------------------------------------------------
// The I/O shell.
//
// Everything above is pure so it can be handed the inputs whose answers are
// known. This part does the fetching, and is deliberately thin: it reads, it
// hands the values to the functions above, and it prints. No decision is taken
// here, because a decision taken here is one no test can reach — which is the
// arrangement this whole file exists to end.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPO = "nextlyhq/nextly";

/** Set by `main` once the head repository is known; a fork keeps its own. */
let REMOTE_FOR_FETCH = "origin";

/**
 * `gh api`, raw. Throws on failure rather than degrading to an empty result.
 *
 * `--jq` prints the filter's output verbatim, NOT as JSON: a string comes back
 * unquoted and an absent value comes back as an empty line. Parsing everything
 * as JSON therefore fails on exactly the case that matters — a pull request
 * with no review verdict yet.
 */
function ghText(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

/** `gh api` where the result really is JSON. Empty output is a failure, not an empty value. */
function ghJson(args) {
  const text = ghText(args);
  if (text === "")
    throw new Error(`gh returned nothing for: ${args.join(" ")}`);
  return JSON.parse(text);
}

/**
 * Every page of the timeline, each page kept SEPARATE.
 *
 * `--paginate` concatenates the pages' arrays into one stream of JSON values,
 * so they are split back apart here: `countRewriteEvents` refuses a page it
 * cannot read, and flattening first would throw that distinction away.
 */
function timelinePages(pr) {
  // `--slurp` returns ONE array of pages, so the pages stay separate without
  // this code parsing JSON itself. The previous version counted brackets to
  // split `--paginate`'s concatenated arrays, which a `[` inside any review
  // body broke: the depth never returned to zero, the function returned no
  // pages, and a force-push counted as zero — the false clean this verifier
  // exists to refuse, introduced by the verifier.
  return JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        "--paginate",
        "--slurp",
        `repos/${REPO}/issues/${pr}/timeline?per_page=100`,
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    )
  );
}

/** `git`, for the two places this shell needs it. */
function run(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Commits the ref has that the merged head does not. */
function ghLog(merged, tip) {
  const out = execFileSync("git", ["log", "--oneline", `${merged}..${tip}`], {
    encoding: "utf8",
  }).trim();
  return out ? out.split("\n") : [];
}

/**
 * A file as it stood at one revision, fetched first so the read cannot silently
 * fall back to whatever the working tree happens to hold.
 */
function workflowAt(revision, path) {
  run(["fetch", "origin", revision, "--quiet"]);
  return execFileSync("git", ["show", `${revision}:${path}`], {
    encoding: "utf8",
  });
}

/** Every configured remote as `[name, url]`, for matching against the head repository. */
function configuredRemotes() {
  const out = execFileSync("git", ["remote", "-v"], { encoding: "utf8" });
  return out
    .split("\n")
    .filter(Boolean)
    .map(line => line.split(/\s+/))
    .map(([name, url]) => [name, url]);
}

/** The branch's real tip, from the ref rather than from the API's cached head. */
function lsRemoteTip(remote, branch) {
  const out = execFileSync(
    "git",
    ["ls-remote", remote, `refs/heads/${branch}`],
    {
      encoding: "utf8",
    }
  );
  return out.split("\t")[0] ?? "";
}

/** Runs the gate for one pull request and prints why, exiting non-zero when blocked. */
export function main(argv) {
  const pr = argv[0];
  if (!pr || !/^\d+$/.test(pr)) {
    process.stderr.write("usage: node scripts/verify-merge.mjs <pr-number>\n");
    return 2;
  }

  const meta = ghJson([
    "api",
    `repos/${REPO}/pulls/${pr}`,
    "--jq",
    "{cross:.head.repo.full_name!=.base.repo.full_name,repo:.head.repo.full_name,branch:.head.ref,merged:.merged,mergeSha:.merge_commit_sha,head:.head.sha}",
  ]);
  REMOTE_FOR_FETCH = remoteForRepo(meta.repo, configuredRemotes());
  const tip = lsRemoteTip(REMOTE_FOR_FETCH, meta.branch);

  // `.merged`, never the presence of `.merge_commit_sha`. GitHub populates that
  // field on OPEN pull requests too, with the throwaway commit from its
  // mergeability test — so keying off it would send every open PR down the
  // post-merge path and judge it on a commit that is not in anyone's history.
  const merged = meta.merged === true;

  // Which revision the checks belong to is the whole difference between the two
  // questions this script answers.
  //
  // Before merging, the branch tip is the thing being proposed and the thing CI
  // ran on. After merging, the squash commit is a DIFFERENT TREE — `main` plus
  // this change — and it is the one that decides whether `main` is green. A
  // head can be green while the merge commit is red, so reading the head after
  // the merge reports on a tree nobody has.
  const subject = merged ? meta.mergeSha : tip;

  const rewrites = countRewriteEvents(timelinePages(pr));
  const reach = checkability({ tip, rewriteEvents: rewrites });

  // Only after a merge is there a merge to have lost anything. Run before one,
  // this compares the API's cached head against the ref and reports ordinary
  // in-flight pushes as candidates.
  let candidates = [];
  if (merged && reach.checkable && meta.head && meta.head !== tip) {
    run(["fetch", REMOTE_FOR_FETCH, tip, "--quiet"]);
    candidates = ghLog(meta.head, tip);
  }
  const landed = merged
    ? landedWhole({ ...reach, candidates })
    : { verdict: "n/a", reason: "not merged", candidates: [] };

  // Paginated. `per_page=100` alone caps the response at one page, so a
  // revision with more than 100 runs hid every later one from `blockingJobs` —
  // a queued or failed job on page two simply not existing as far as the gate
  // was concerned.
  const checkRuns = subject
    ? flatPages(
        ghJson([
          "api",
          "--paginate",
          "--slurp",
          `repos/${REPO}/commits/${subject}/check-runs?per_page=100`,
        ]),
        "check-runs"
      ).flatMap(page => page.check_runs ?? [])
    : [];

  // Every file the pull request touches, so a check that was never due to run
  // is not reported as one that failed to. Paginated: a change set larger than
  // one page would otherwise look small enough to have skipped a workflow.
  const changedPaths = flatPages(
    ghJson([
      "api",
      "--paginate",
      "--slurp",
      `repos/${REPO}/pulls/${pr}/files?per_page=100`,
    ]),
    "changed files"
  )
    .flat()
    .map(file => file?.filename)
    .filter(name => typeof name === "string");

  // Read from the workflow, for the trigger whose run produced the checks being
  // judged: `pull_request` before a merge, `push` to the base branch after one.
  // The two blocks are edited independently, so answering from the wrong one
  // waits for a check that will never report or excuses one that should have.
  // From the revision being judged, not from the working tree. The two differ
  // whenever the checkout has moved on, and this command is expected to run
  // outside the pull request's worktree: a later commit adding a path to
  // `paths-ignore` would otherwise excuse checks that an older merge was
  // genuinely due to create.
  const integrationIgnore = workflowPathsIgnore(
    workflowAt(subject, ".github/workflows/integration.yml"),
    merged ? "push" : "pull_request"
  );
  const required = requiredChecks(integrationIgnore);
  // Paginated. A pull request with more than 100 review threads would
  // otherwise have everything past the first page counted as resolved, which
  // is the reassuring direction.
  let threads = 0;
  let cursor = null;
  for (;;) {
    const after = cursor ? `, after: "${cursor}"` : "";
    const page = JSON.parse(
      ghText([
        "api",
        "graphql",
        "-f",
        `query=query { repository(owner:"nextlyhq",name:"nextly"){ pullRequest(number:${pr}){ reviewThreads(first:100${after}){ pageInfo { hasNextPage endCursor } nodes { isResolved } } } } }`,
        "--jq",
        "{n:[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false)]|length, more:.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage, cur:.data.repository.pullRequest.reviewThreads.pageInfo.endCursor}",
      ])
    );
    threads += page.n;
    if (!page.more) break;
    cursor = page.cur;
  }

  // From the review RECORD's own `commit_id`, not from a comment body. An
  // issue comment is not evidence a review covered a commit: the previous
  // version matched any backticked hex in the latest bot comment, which
  // accepts progress text that happens to name the sha and misses a real
  // review whose sha never appears in prose.
  // `--slurp` returns an array of PAGES and cannot be combined with `--jq`,
  // so the flattening happens here rather than in the query.
  const reviews = ghJson([
    "api",
    "--paginate",
    "--slurp",
    `repos/${REPO}/pulls/${pr}/reviews?per_page=100`,
  ]).flat();
  const CODEX = "chatgpt-codex-connector[bot]";
  const reviewedSha = reviews
    .filter(r => r?.user?.login === CODEX && r?.commit_id)
    .map(r => r.commit_id)
    .pop();
  // Scoped to THIS revision: a review of an earlier one is not coverage of it.
  const coderabbit = reviewsCoveringTip(
    reviews,
    tip,
    "coderabbitai[bot]"
  ).length;

  // Commit STATUSES are a separate surface from check-runs, and this
  // repository's title check and CodeRabbit both report through it.
  // Guarded like the check-runs lookup above. Unguarded, an empty `tip`
  // produced `commits//status`, which throws before the script can print
  // NOT CHECKABLE or return its exit code — so the documented refusal became
  // a stack trace.
  // Keyed off `subject` for the same reason the check-runs are: statuses are
  // per-commit exactly as check-runs are, so leaving this one on the tip would
  // judge a merged pull request half on the merge commit and half on the branch
  // — and the half still reading the branch is the half that reports green.
  const statuses = subject
    ? flatPages(
        ghJson([
          "api",
          "--paginate",
          "--slurp",
          `repos/${REPO}/commits/${subject}/status?per_page=100`,
        ]),
        "statuses"
      ).flatMap(page => page.statuses ?? [])
    : [];
  const allChecks = [...checkRuns, ...statuses.map(statusAsRun)];

  const verdict = gateVerdict({
    // Deliberately the TIP even after a merge, unlike the checks above. A review
    // is written against the branch revision the reviewer read; no bot ever
    // reviews a squash commit, so comparing a verdict to `subject` post-merge
    // would report every merged pull request as unreviewed.
    tip,
    unresolvedThreads: threads,
    checkRuns: allChecks,
    changedPaths,
    required,
    codexReviewedSha: reviewedSha,
    coderabbitReviewCount: coderabbit,
  });

  process.stdout.write(
    `PR #${pr} @ ${(subject || "").slice(0, 9) || "(no ref)"}` +
      `${merged ? ` (merge commit; branch ${tip.slice(0, 9)})` : ""}\n`
  );
  process.stdout.write(
    `  landed-whole: ${landed.verdict} (${landed.reason})\n`
  );
  for (const line of landed.candidates) {
    process.stdout.write(`    candidate, confirm by content: ${line}\n`);
  }
  process.stdout.write(`${formatVerdict(verdict)}\n`);
  // Everything above was read across many round trips, all keyed to the `tip`
  // read at the start. A push landing during them leaves every answer describing
  // a revision the branch no longer has, and the gate would report a pass for a
  // commit nothing checked or reviewed.
  //
  // This REFUSES on a difference; it must never re-key the verdict to the new
  // head. That distinction is the whole point, and the opposite mistake is easy
  // to make here: adopting the fresh head would rubber-stamp exactly the
  // unverified revision this is detecting. The verdict stays with the revision
  // that was actually examined, and the caller is told it is now stale.
  //
  // It narrows the window rather than closing it — the read and the merge are
  // still separate operations. `gh pr merge --match-head-commit <tip>` is what
  // closes it, because there the server refuses.
  // The merged STATE is re-read alongside the tip, not only the tip. A pull
  // request that merges during the intervening calls usually leaves its branch
  // untouched, so a tip comparison alone passes — while every answer above was
  // taken in the pre-merge mode, judging the branch head with the landed-whole
  // question never asked. The mode is as much a part of what was verified as
  // the revision is.
  const stale = staleVerification({
    mergedAtStart: merged,
    mergedNow:
      ghText(["api", `repos/${REPO}/pulls/${pr}`, "--jq", ".merged"]) === "true",
    tipAtStart: tip,
    tipNow: lsRemoteTip(REMOTE_FOR_FETCH, meta.branch),
  });
  if (stale) {
    process.stdout.write(
      `  ${stale}: this verdict describes ${tip.slice(0, 9)} as it stood when ` +
        "the check began, and is no longer current\n"
    );
    return 2;
  }

  return exitCode({
    landedVerdict: landed.verdict,
    mergeable: verdict.mergeable,
  });
}

/**
 * The executable boundary, where a failure to look becomes exit 2.
 *
 * Every helper below the pure section throws rather than degrading, which is
 * right — but an uncaught throw exits 1, and 1 is the code meaning this gate
 * examined the revision and rejected it. An expired token, an unreachable API,
 * a malformed response or a failed fetch would therefore be indistinguishable
 * from a verdict, and a caller would stop rather than retry.
 *
 * `run` is injectable so this decision can be given a failure and asked what it
 * returns; that is the only reason it is a parameter.
 */
export function runCli(argv, run = main) {
  try {
    return run(argv);
  } catch (error) {
    process.stderr.write(
      `verify-merge: could not complete the check — ${error?.message ?? error}\n` +
        "This is exit 2 (unanswered), not a rejection. Retry, or check auth.\n"
    );
    return 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(runCli(process.argv.slice(2)));
}
