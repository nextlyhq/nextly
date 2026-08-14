// Decides whether a pull request has been reviewed at its CURRENT head and
// whether anything is still open, and refuses when it has not.
//
// "No findings" and "no review" produce the same empty result from every
// reviews query, so a gate that counts findings alone reports a pass for a
// revision nobody looked at. Coverage is therefore asked separately from
// outstanding work, and each comes from the source that owns it: a review
// object proves a reviewer saw a commit whether or not it carried findings,
// and GitHub's own thread resolution state says what is still open.
//
// Counting a reviewer's findings would be a proxy for the second question and a
// worse one, because reviewers do not agree on what a review object is: one
// posts a single object per round carrying many comments, another posts one
// object per finding. No rule over objects means the same thing for both.
//
// Every function here is pure. The caller fetches; these decide. A function
// that performs its own I/O cannot be handed the inputs it must get right.

/** Reviewers whose verdict blocks a merge, and the marker text of a refusal. */
export const RATE_LIMIT_MARKER = /Review limit reached/;

/**
 * The reviewer logins that submitted any review at `head`.
 *
 * Matched on the COMPLETE login. GitHub app logins carry a `[bot]` suffix, so
 * comparing against the un-suffixed name returns nothing and is
 * indistinguishable from "not yet reviewed". A substring match would accept any
 * login containing the name, letting any account that can comment present
 * itself as a trusted reviewer.
 */
export function reviewersAtHead(reviews, head) {
  if (!Array.isArray(reviews) || typeof head !== "string" || head === "") {
    return [];
  }
  const seen = new Set();
  for (const review of reviews) {
    const login = review?.user?.login;
    if (typeof login === "string" && review?.commit_id === head) {
      seen.add(login);
    }
  }
  return [...seen].sort();
}

/** Required reviewers with no review at `head`, in the order they were required. */
export function missingReviewers(reviews, head, required) {
  const seen = new Set(reviewersAtHead(reviews, head));
  return (required ?? []).filter(login => !seen.has(login));
}

/**
 * Review threads still open.
 *
 * Read from thread state rather than reconstructed from comment counts: a
 * thread stays open across re-reviews of one commit, and its resolution is what
 * "this finding is dealt with" actually records.
 */
export function unresolvedThreads(threads) {
  if (!Array.isArray(threads)) return 0;
  return threads.filter(thread => thread?.isResolved === false).length;
}

/**
 * Reviewers that announced they were rate limited and reviewed nothing.
 *
 * Only ever a reason to REFUSE. The marker is edited away when a review later
 * runs, so its absence says nothing about whether anything was reviewed; that
 * question is answered by {@link missingReviewers}.
 */
export function rateLimited(issueComments) {
  if (!Array.isArray(issueComments)) return [];
  const found = new Set();
  for (const comment of issueComments) {
    const login = comment?.user?.login;
    const body = comment?.body;
    if (typeof login === "string" && typeof body === "string" && RATE_LIMIT_MARKER.test(body)) {
      found.add(login);
    }
  }
  return [...found].sort();
}

/**
 * The merge verdict, and the exit code a caller must honour.
 *
 * Ordered so the most fundamental gap is reported first: a revision nobody
 * reviewed is a different problem from one reviewed with findings outstanding,
 * and reporting the second while the first holds would send someone to resolve
 * threads on a commit that was never read.
 *
 * `blocking` is empty for an advisory reviewer: its coverage is reported and
 * does not decide, because a shared review quota is exhausted by traffic that
 * has nothing to do with this pull request.
 */
export function verdictFor({ missing = [], unresolved = 0, limited = [], blocking = [] } = {}) {
  const blockingMissing = missing.filter(login => blocking.includes(login));
  const blockingLimited = limited.filter(login => blocking.includes(login));

  if (blockingMissing.length > 0) {
    return { verdict: "MISSING REVIEW AT HEAD", detail: blockingMissing, exitCode: 1 };
  }
  if (unresolved > 0) {
    return { verdict: "UNRESOLVED THREADS", detail: unresolved, exitCode: 1 };
  }
  if (blockingLimited.length > 0) {
    return { verdict: "REVIEWER RATE LIMITED", detail: blockingLimited, exitCode: 1 };
  }
  return { verdict: "CLEAN", detail: null, exitCode: 0 };
}

/**
 * Assemble the report a caller prints.
 *
 * Advisory reviewers appear in the report so a gap is visible, and are absent
 * from `blocking` so they cannot hold a merge.
 */
export function report({ head, reviews, threads, issueComments, blocking, advisory = [] }) {
  const required = [...(blocking ?? []), ...advisory];
  const missing = missingReviewers(reviews, head, required);
  const unresolved = unresolvedThreads(threads);
  const limited = rateLimited(issueComments);
  const { verdict, detail, exitCode } = verdictFor({ missing, unresolved, limited, blocking });

  return {
    head,
    reviewed_head: reviewersAtHead(reviews, head),
    missing_reviews: missing,
    unresolved_threads: unresolved,
    rate_limited: limited,
    advisory,
    verdict,
    detail,
    exitCode,
  };
}
