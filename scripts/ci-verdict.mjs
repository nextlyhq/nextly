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
    // A PENDING review is an unsubmitted draft: its author has not said
    // anything about the revision yet, so counting it reports coverage nobody
    // provided.
    if (
      typeof login === "string" &&
      review?.commit_id === head &&
      review?.state !== "PENDING"
    ) {
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
  if (!Array.isArray(threads)) return Number.POSITIVE_INFINITY;
  // Anything other than an explicit `true` counts as open. A node missing the
  // field, or a partial response, means resolution could not be established —
  // which is not the same as having established that nothing is open, and only
  // one of those may clear a gate.
  return threads.filter(thread => thread?.isResolved !== true).length;
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
    if (
      typeof login === "string" &&
      typeof body === "string" &&
      RATE_LIMIT_MARKER.test(body)
    ) {
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
export function verdictFor({
  missing = [],
  unresolved = 0,
  limited = [],
  blocking = [],
} = {}) {
  const blockingMissing = missing.filter(login => blocking.includes(login));
  const blockingLimited = limited.filter(login => blocking.includes(login));

  // Rate limiting is reported BEFORE absence, because a reviewer that refused
  // for quota is necessarily also absent: ordering absence first would make
  // this verdict unreachable for the only state that produces it, and would
  // send someone to chase a review that was never going to arrive.
  if (blockingLimited.length > 0) {
    return {
      verdict: "REVIEWER RATE LIMITED",
      detail: blockingLimited,
      exitCode: 1,
    };
  }
  if (blockingMissing.length > 0) {
    return {
      verdict: "MISSING REVIEW AT HEAD",
      detail: blockingMissing,
      exitCode: 1,
    };
  }
  if (unresolved > 0) {
    return { verdict: "UNRESOLVED THREADS", detail: unresolved, exitCode: 1 };
  }
  return { verdict: "CLEAN", detail: null, exitCode: 0 };
}

/**
 * Assemble the report a caller prints.
 *
 * Advisory reviewers appear in the report so a gap is visible, and are absent
 * from `blocking` so they cannot hold a merge.
 */
export function report({
  head,
  reviews,
  threads,
  issueComments,
  blocking,
  advisory = [],
}) {
  const required = [...(blocking ?? []), ...advisory];
  const missing = missingReviewers(reviews, head, required);
  const unresolved = unresolvedThreads(threads);
  const limited = rateLimited(issueComments);
  const { verdict, detail, exitCode } = verdictFor({
    missing,
    unresolved,
    limited,
    blocking,
  });

  return {
    head,
    reviewed_head: reviewersAtHead(reviews, head),
    missing_reviews: missing,
    // JSON has no infinity, so an unavailable count would serialise as `null`
    // and read like a zero to anything consuming the report as data.
    unresolved_threads: Number.isFinite(unresolved)
      ? unresolved
      : "unavailable",
    rate_limited: limited,
    advisory,
    verdict,
    detail,
    exitCode,
  };
}

/**
 * Command line entry: `node scripts/ci-verdict.mjs <pr>`.
 *
 * Kept behind the module-vs-main check so importing the decisions never
 * performs a request. Exits with the verdict's code, so a caller that only
 * checks the status gets the refusal without parsing anything.
 */
async function main(argv) {
  const [pr] = argv;
  if (!pr) {
    process.stderr.write("usage: node scripts/ci-verdict.mjs <pr-number>\n");
    return 2;
  }
  const repo = process.env.GH_REPO ?? "nextlyhq/nextly";
  const [owner, name] = repo.split("/");
  const { execFileSync } = await import("node:child_process");

  // Each query is its own process and its failure is its own exception: a
  // rejected request must reach the caller as a refusal, never as empty data.
  const gh = args =>
    JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64e6 }));
  const head = gh([
    "pr",
    "view",
    pr,
    "--repo",
    repo,
    "--json",
    "headRefOid",
  ]).headRefOid;
  const reviews = gh([
    "api",
    `repos/${repo}/pulls/${pr}/reviews`,
    "--paginate",
    "--slurp",
  ]).flat();
  const issueComments = gh([
    "api",
    `repos/${repo}/issues/${pr}/comments`,
    "--paginate",
    "--slurp",
  ]).flat();
  const threads = gh([
    "api",
    "graphql",
    "-F",
    `pr=${pr}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-f",
    "query=query($pr:Int!,$owner:String!,$name:String!){ repository(owner:$owner,name:$name)" +
      "{ pullRequest(number:$pr){ reviewThreads(first:100){ nodes { isResolved } } } } }",
  ]).data.repository.pullRequest.reviewThreads.nodes;

  const result = report({
    head,
    reviews,
    threads,
    issueComments,
    blocking: (
      process.env.CI_VERDICT_BLOCKING ?? "chatgpt-codex-connector[bot]"
    )
      .split(",")
      .filter(Boolean),
    advisory: (process.env.CI_VERDICT_ADVISORY ?? "coderabbitai[bot]")
      .split(",")
      .filter(Boolean),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    error => {
      process.stderr.write(`ci-verdict: ${error.message}\n`);
      process.exit(2);
    }
  );
}
