/**
 * Decides whether a pull request may merge, and whether a merged one landed
 * whole.
 *
 * `.claude/rules/verifying-merged-work.md` describes this procedure in prose
 * with runnable shell in it. Prose does not run, so nothing checked the shell
 * and it was wrong in three separate ways that all looked like a pass: a count
 * computed and never read, an exit status swallowed by the pipeline that
 * consumed it, and a comparison against a base that moves. Each was found by a
 * reader executing the snippet mentally, one at a time.
 *
 * The decisions live here as pure functions so they can be given inputs whose
 * answers are known. Every I/O call stays in the caller: a function that
 * fetches cannot be handed the case it must get right.
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
    for (const name of missingRequired(checkRuns)) {
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
export function missingRequired(checkRuns, required = REQUIRED_CHECKS) {
  if (!Array.isArray(checkRuns)) {
    throw new TypeError("missingRequired needs an array of check-runs");
  }
  const present = new Set(checkRuns.map(run => run?.name));
  return required.filter(name => !present.has(name));
}

/**
 * The job every other job in `ci.yml` depends on through `needs: [ci]`.
 *
 * If it never reported, the browser, scaffold and dev-script jobs did not run
 * either — so its absence means the revision has no build or test coverage at
 * all, however many unrelated workflows went green.
 */
export const REQUIRED_CHECKS = Object.freeze([
  "Lint / Typecheck / Test / Build",
]);

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
    "{cross:.head.repo.full_name!=.base.repo.full_name,repo:.head.repo.full_name,branch:.head.ref}",
  ]);
  const remote = meta.cross ? `https://github.com/${meta.repo}.git` : "origin";
  const tip = lsRemoteTip(remote, meta.branch);

  const rewrites = countRewriteEvents(timelinePages(pr));
  const reach = checkability({ tip, rewriteEvents: rewrites });

  const checkRuns = tip
    ? ghJson([
        "api",
        `repos/${REPO}/commits/${tip}/check-runs?per_page=100`,
        "--jq",
        ".check_runs",
      ])
    : [];
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
  const statuses = ghJson([
    "api",
    `repos/${REPO}/commits/${tip}/status`,
    "--jq",
    ".statuses",
  ]);
  const allChecks = [...checkRuns, ...statuses.map(statusAsRun)];

  const verdict = gateVerdict({
    tip,
    unresolvedThreads: threads,
    checkRuns: allChecks,
    codexReviewedSha: reviewedSha,
    coderabbitReviewCount: coderabbit,
  });

  process.stdout.write(`PR #${pr} @ ${tip.slice(0, 9) || "(no ref)"}\n`);
  process.stdout.write(
    `  landed-whole check: ${reach.checkable ? "available" : `NOT CHECKABLE (${reach.reason})`}\n`
  );
  process.stdout.write(`${formatVerdict(verdict)}\n`);
  // Not checkable is not clean. Returning 0 here would let automation treat
  // the history-rewrite case as a pass — the one state this file exists to
  // distinguish from a pass.
  if (!reach.checkable) return 2;
  return verdict.mergeable ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main(process.argv.slice(2)));
}
