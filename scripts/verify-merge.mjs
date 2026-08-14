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
 * expresses "this commit cannot affect me", and branch protection accepts it.
 * Everything else that is not `success` does NOT pass — including `queued` and
 * `in_progress`, which are the ones that get miscounted: filtering for
 * `conclusion === "failure"` and finding none reads as green while nothing has
 * run. One merge commit here had four required jobs queued for hours and two
 * unrelated ones completed, and answered zero failures throughout.
 */
export function jobPasses(run) {
  return run?.conclusion === "success" || run?.conclusion === "skipped";
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
  const shorter = Math.min(reviewedSha.length, tip.length);
  // A prefix comparison is only meaningful at a length that can identify a
  // commit. Seven is git's own floor for an abbreviated sha.
  if (shorter < 7) return false;
  return reviewedSha.slice(0, shorter) === tip.slice(0, shorter);
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

  if (!Number.isInteger(unresolvedThreads)) {
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
