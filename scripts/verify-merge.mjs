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
  const raw = execFileSync(
    "gh",
    ["api", "--paginate", `repos/${REPO}/issues/${pr}/timeline?per_page=100`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  // `gh --paginate` emits one JSON array per page, concatenated. A single
  // `JSON.parse` sees only the first.
  const pages = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "[") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        pages.push(JSON.parse(raw.slice(start, i + 1)));
        start = -1;
      }
    }
  }
  return pages;
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
  const threads = Number(
    ghText([
      "api",
      "graphql",
      "-f",
      `query=query { repository(owner:"nextlyhq",name:"nextly"){ pullRequest(number:${pr}){ reviewThreads(first:100){ nodes { isResolved } } } } }`,
      "--jq",
      "[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false)]|length",
    ])
  );
  const codexBody = ghText([
    "api",
    `repos/${REPO}/issues/${pr}/comments?per_page=100`,
    "--jq",
    '[.[]|select(.user.login=="chatgpt-codex-connector[bot]")|.body]|last // ""',
  ]);
  const reviewedSha = (String(codexBody).match(/`([0-9a-f]{7,40})`/g) ?? [])
    .map(match => match.replaceAll("`", ""))
    .pop();
  const coderabbit = Number(
    ghText([
      "api",
      `repos/${REPO}/pulls/${pr}/reviews?per_page=100`,
      "--jq",
      '[.[]|select(.user.login=="coderabbitai[bot]")]|length',
    ])
  );

  const verdict = gateVerdict({
    tip,
    unresolvedThreads: threads,
    checkRuns,
    codexReviewedSha: reviewedSha,
    coderabbitReviewCount: coderabbit,
  });

  process.stdout.write(`PR #${pr} @ ${tip.slice(0, 9) || "(no ref)"}\n`);
  process.stdout.write(
    `  landed-whole check: ${reach.checkable ? "available" : `NOT CHECKABLE (${reach.reason})`}\n`
  );
  process.stdout.write(`${formatVerdict(verdict)}\n`);
  return verdict.mergeable ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main(process.argv.slice(2)));
}
