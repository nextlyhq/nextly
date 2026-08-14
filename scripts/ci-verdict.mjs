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

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Reviewers whose verdict blocks a merge, and the marker text of a refusal. */
export const RATE_LIMIT_MARKER = /Review limit reached/;

/**
 * Review states that represent an opinion its author has published.
 *
 * `PENDING` is an unsubmitted draft and `DISMISSED` has been explicitly
 * withdrawn, so neither is anybody saying anything about the revision.
 */
const SUBMITTED = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]);

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
    // Only a SUBMITTED opinion is coverage. Allowing every state that is not
    // `PENDING` would count a withdrawn review, and a state this code has not
    // seen before would default to counting rather than to refusing.
    if (
      typeof login === "string" &&
      review?.commit_id === head &&
      SUBMITTED.has(review?.state)
    ) {
      seen.add(login);
    }
  }
  return [...seen].sort();
}

/**
 * Reviewers whose standing position at `head` is that changes are required.
 *
 * A `CHANGES_REQUESTED` review states its case in the body and need not open a
 * single thread, so thread resolution cannot see it: without this, an explicit
 * refusal reads as coverage with nothing outstanding.
 *
 * Deliberately NOT scoped to the head. A request for changes is a standing
 * position on the pull request, not on one revision: pushing a commit does not
 * answer it, and a later `COMMENTED` review on the new head does not either. A
 * head-scoped version discards the whole objection the moment the author
 * pushes, which is the state it most needs to survive.
 */
export function changesRequested(reviews) {
  if (!Array.isArray(reviews)) return [];
  // Ordered oldest first, so each account's later reviews decide what survives.
  const ordered = reviews
    .filter(review => typeof review?.user?.login === "string")
    .slice()
    .sort((a, b) =>
      `${a.submitted_at ?? ""}`.localeCompare(`${b.submitted_at ?? ""}`)
    );

  const outstanding = new Set();
  for (const review of ordered) {
    const login = review.user.login;
    // A COMMENTED review publishes feedback without withdrawing an objection,
    // so only an approval or an explicit dismissal clears one. Treating any
    // later review as clearance lets a follow-up remark retire a request for
    // changes nobody answered.
    if (review.state === "CHANGES_REQUESTED") outstanding.add(login);
    else if (review.state === "APPROVED" || review.state === "DISMISSED") {
      outstanding.delete(login);
    }
  }
  return [...outstanding].sort();
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
export function unresolvedThreads(threads, advisory = []) {
  if (!Array.isArray(threads)) return Number.POSITIVE_INFINITY;
  // Anything other than an explicit `true` counts as open. A node missing the
  // field, or a partial response, means resolution could not be established —
  // which is not the same as having established that nothing is open, and only
  // one of those may clear a gate.
  //
  // A thread opened by an ADVISORY reviewer does not count. Blocking on it
  // would let a reviewer that cannot block the merge hold it anyway, through a
  // different door than the one the policy closed. An author this code cannot
  // read counts, because "I could not tell whose it is" is not "it is safe to
  // ignore".
  return threads.filter(thread => {
    if (thread?.isResolved === true) return false;
    const author = thread?.comments?.nodes?.[0]?.author?.login;
    return !(typeof author === "string" && advisory.includes(author));
  }).length;
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
  refused = [],
  blocking = [],
  state = "OPEN",
  stranded = 0,
} = {}) {
  // A merged pull request is not a gate outcome, and every other answer here
  // describes one. Reporting "no review at the head" for a merged PR is true
  // and useless: the branch keeps moving after the merge, so the gate would
  // repeat that forever while commits pushed since sit outside the merge.
  if (state === "MERGED") {
    return {
      // "CANDIDATES", not "STRANDED": the range says only that these commits
      // are absent from the merge, and a branch reused for follow-up work
      // collects such commits legitimately. Confirmation is by content against
      // the squash, which this function has no inputs for — so it names them
      // and refuses, rather than claiming work was lost.
      verdict:
        stranded > 0 ? "MERGED WITH UNMERGED CANDIDATES" : "ALREADY MERGED",

      detail: { state, unmergedCandidates: stranded },
      exitCode: stranded > 0 ? 1 : 0,
    };
  }
  // Closed without merging is a refusal, not a completion. Sharing the merged
  // branch would report success for a pull request whose work never landed.
  if (state !== "OPEN") {
    return {
      verdict: "CLOSED WITHOUT MERGING",
      detail: { state, unmergedCandidates: stranded },
      exitCode: 1,
    };
  }

  const blockingMissing = missing.filter(login => blocking.includes(login));
  const blockingLimited = limited.filter(login => blocking.includes(login));
  const blockingRefused = refused.filter(login => blocking.includes(login));

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
  // Checked alongside open threads rather than after them, because a review
  // stating its case in the body opens none: thread resolution cannot see it.
  if (blockingRefused.length > 0) {
    return {
      verdict: "CHANGES REQUESTED",
      detail: blockingRefused,
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
  state = "OPEN",
  stranded = 0,
}) {
  // De-duplicated: a login named in both lists would otherwise be reported
  // missing twice, which reads as two reviewers rather than one.
  // Blocking wins wherever the two lists overlap, derived once here rather
  // than at each use: a login left in both would be exempted from thread
  // blocking by the advisory list while being required for coverage.
  const blockingList = blocking ?? [];
  const effectiveAdvisory = advisory.filter(
    login => !blockingList.includes(login)
  );
  const required = [...new Set([...blockingList, ...effectiveAdvisory])];
  const missing = missingReviewers(reviews, head, required);
  const unresolved = unresolvedThreads(threads, effectiveAdvisory);
  const limited = rateLimited(issueComments);
  // Coverage is asked at the head; a standing objection is asked of the whole
  // pull request. Two questions with two scopes, from the same rows.
  const refused = changesRequested(reviews);
  const { verdict, detail, exitCode } = verdictFor({
    missing,
    unresolved,
    limited,
    refused,
    blocking,
    state,
    stranded,
  });

  return {
    head,
    state,
    // Named for what the range establishes — absence from the merge — rather
    // than for the conclusion only a content comparison can reach.
    unmerged_candidates: stranded,
    reviewed_head: reviewersAtHead(reviews, head),
    missing_reviews: missing,
    // JSON has no infinity, so an unavailable count would serialise as `null`
    // and read like a zero to anything consuming the report as data.
    unresolved_threads: Number.isFinite(unresolved)
      ? unresolved
      : "unavailable",
    rate_limited: limited,
    changes_requested: refused,
    advisory: effectiveAdvisory,
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
  // Validated before it reaches a URL. A value carrying `/` or `..` rewrites
  // the request path, so the verdict would describe a different pull request
  // while naming the one that was asked for.
  if (!pr || !/^[1-9][0-9]*$/.test(pr)) {
    process.stderr.write("usage: node scripts/ci-verdict.mjs <pr-number>\n");
    return 2;
  }
  // `gh` defines GH_REPO as `[HOST/]OWNER/REPO`, so the owner is the
  // second-to-last segment rather than the first.
  const configured = process.env.GH_REPO ?? "nextlyhq/nextly";
  const segments = configured.split("/").filter(Boolean);
  if (segments.length < 2 || segments.length > 3) {
    process.stderr.write(`ci-verdict: GH_REPO must be [HOST/]OWNER/REPO\n`);
    return 2;
  }
  const [name] = segments.slice(-1);
  const [owner] = segments.slice(-2, -1);
  // `GH_HOST` supplies the hostname when GH_REPO does not carry one, which is
  // the ordinary Enterprise configuration. Defaulting straight to github.com
  // would override that selection with the explicit `--hostname` below.
  const host =
    segments.length === 3 ? segments[0] : (process.env.GH_HOST ?? "github.com");

  const repo = `${owner}/${name}`;
  const { execFileSync } = await import("node:child_process");
  // Each query is its own process and its failure is its own exception: a
  // rejected request must reach the caller as a refusal, never as empty data.
  // `--hostname` on every API call, and a host-qualified `--repo`. Parsing the
  // host out of GH_REPO and then letting the requests default sends them to
  // public GitHub while claiming to describe an Enterprise repository.
  const gh = args =>
    JSON.parse(
      execFileSync(
        "gh",
        args[0] === "api"
          ? ["api", "--hostname", host, ...args.slice(1)]
          : args,
        { encoding: "utf8", maxBuffer: 64e6 }
      )
    );
  const repoArg = host === "github.com" ? repo : `${host}/${repo}`;

  // The head comes from the REF, not from the pull request object. GitHub's
  // `headRefOid` lags a push — measured a full commit behind while `ls-remote`
  // was already correct — so a gate reading it can certify a revision that is
  // no longer the head, which is the exact class of defect it exists to stop.
  const meta = gh([
    "pr",
    "view",
    pr,
    "--repo",
    repoArg,
    "--json",
    "headRefName,isCrossRepository,headRepositoryOwner,headRepository,state,headRefOid",
  ]);
  // A fork's branch is not on `origin`, so the ref is read from the repository
  // that HAS it. `refs/pull/<pr>/head` is not a substitute: it is the same
  // snapshot `headRefOid` reports and lags a push identically — measured, a
  // full commit behind the branch while the branch ref was current.
  // The host comes from GH_REPO when it carries one. Hard-coding github.com
  // sends an Enterprise fork lookup to the public host, where it either fails
  // or finds an unrelated repository of the same name and evaluates reviews
  // against its SHA.
  // Both remotes are derived from the configured repository rather than from
  // the checkout. `origin` is whatever this working copy happens to point at,
  // which need not be the repository GH_REPO selected — the API data would then
  // describe one repository while the SHA came from another.
  const headRemote = meta.isCrossRepository
    ? `https://${host}/${meta.headRepositoryOwner.login}/${meta.headRepository.name}.git`
    : `https://${host}/${repo}.git`;

  const headOf = () => {
    const line = execFileSync(
      "git",
      ["ls-remote", headRemote, `refs/heads/${meta.headRefName}`],
      { encoding: "utf8" }
    ).trim();
    const sha = line.split(/\s+/)[0];
    if (!sha) {
      throw new Error(
        `no such ref on ${headRemote}: refs/heads/${meta.headRefName}`
      );
    }
    return sha;
  };
  const head = headOf();
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
  // Paged explicitly: `reviewThreads(first: 100)` silently truncates, and an
  // unresolved thread past the first page would leave the verdict clean. An
  // invalid `after` is NOT rejected by the API — it is ignored and page one
  // comes back — so the first page omits the argument rather than relying on a
  // value being coerced.
  const readThreads = () => {
    const collected = [];
    let cursor = null;
    for (;;) {
      const page = gh([
        "api",
        "graphql",
        "-F",
        `pr=${pr}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        ...(cursor === null ? [] : ["-F", `cursor=${cursor}`]),
        "-f",
        "query=query($pr:Int!,$owner:String!,$name:String!,$cursor:String){" +
          " repository(owner:$owner,name:$name){ pullRequest(number:$pr){" +
          " reviewThreads(first:100, after:$cursor){" +
          " nodes { isResolved comments(first:1){ nodes { author { login } } } }" +
          " pageInfo { hasNextPage endCursor } } } } }",
      ]).data.repository.pullRequest.reviewThreads;
      collected.push(...page.nodes);
      // Pagination metadata is REQUIRED rather than optional. A response
      // without it would otherwise read as the final page and silently drop
      // every later thread, and a `hasNextPage` that never advances its cursor
      // would re-request one page forever.
      const info = page.pageInfo;
      if (typeof info?.hasNextPage !== "boolean") {
        throw new Error("reviewThreads returned no pagination metadata");
      }
      if (!info.hasNextPage) break;
      if (typeof info.endCursor !== "string" || info.endCursor === "") {
        throw new Error("reviewThreads reported another page with no cursor");
      }
      if (info.endCursor === cursor) {
        throw new Error(
          "reviewThreads returned a cursor that does not advance"
        );
      }
      cursor = info.endCursor;
    }
    return collected;
  };
  const threads = readThreads();

  // The head is re-read AFTER the other queries. A push landing mid-run would
  // otherwise be judged against the revision captured at the start, so a review
  // covering the old head could clear a revision nobody has seen.
  const headNow = headOf();
  if (headNow !== head) {
    process.stderr.write(
      `ci-verdict: head moved ${head} -> ${headNow}; re-run\n`
    );
    return 2;
  }

  // Review state mutates without moving the head, so the head check alone
  // cannot see a thread opened or unresolved mid-run. The verdict below is
  // computed from the first snapshot, and a snapshot known to be stale must not
  // be reported as clean.
  // Compared by CONTENT, not by count. A body-only CHANGES_REQUESTED arriving
  // after the reviews query, or an existing thread being unresolved, leaves the
  // number of rows unchanged — so a length check accepts a snapshot that has
  // already gone stale, and only ever catches the shape of change it was
  // written for.
  // Issue comments are in the snapshot because the rate-limit marker is EDITED
  // IN PLACE: a blocking reviewer can add or remove it without any review being
  // submitted and without the head moving, so every other check here stays
  // identical while the verdict it feeds flips.
  const fingerprint = (rv, th, ic) =>
    JSON.stringify([
      rv.map(r => [r?.id, r?.user?.login, r?.commit_id, r?.state]),
      th.map(t => [t?.isResolved, t?.comments?.nodes?.[0]?.author?.login]),
      ic.map(c => [
        c?.id,
        c?.user?.login,
        RATE_LIMIT_MARKER.test(c?.body ?? ""),
      ]),
    ]);
  const reviewsNow = gh([
    "api",
    `repos/${repo}/pulls/${pr}/reviews`,
    "--paginate",
    "--slurp",
  ]).flat();
  const issueCommentsNow = gh([
    "api",
    `repos/${repo}/issues/${pr}/comments`,
    "--paginate",
    "--slurp",
  ]).flat();
  if (
    fingerprint(reviews, threads, issueComments) !==
    fingerprint(reviewsNow, readThreads(), issueCommentsNow)
  ) {
    process.stderr.write("ci-verdict: review state changed mid-run; re-run\n");
    return 2;
  }

  // The head is checked again AFTER that comparison, because the comparison
  // itself performs several requests. A push landing during them moves the head
  // without changing any review state, so the fingerprints match and the
  // verdict would otherwise describe a revision that is no longer current.
  if (headOf() !== head) {
    process.stderr.write("ci-verdict: head moved during the recheck; re-run\n");
    return 2;
  }

  // Trimmed: a list written with spaces after the commas yields entries that
  // match no login, and an unmatched blocking reviewer is silently dropped —
  // the gate then reports clean without that reviewer's coverage.
  const logins = value =>
    value
      .split(",")
      .map(entry => entry.trim())
      .filter(Boolean);
  const blocking = logins(
    process.env.CI_VERDICT_BLOCKING ?? "chatgpt-codex-connector[bot]"
  );
  const advisory = logins(
    process.env.CI_VERDICT_ADVISORY ?? "coderabbitai[bot]"
  );
  if (blocking.length === 0) {
    process.stderr.write("ci-verdict: no blocking reviewer configured\n");
    return 2;
  }

  // A merged pull request keeps a branch that can still be pushed to, and
  // GitHub's own `headRefOid` freezes at the revision that merged. Commits
  // after that point are in neither, so they are counted here rather than left
  // to be noticed.
  // A branch that was force-pushed, deleted or restored cannot certify its own
  // tail: resetting it back to the merged head leaves an empty range that is
  // indistinguishable from a branch that never advanced, which is precisely the
  // tail this check exists to find. Refuse rather than report zero.
  const rewriteEvents = () =>
    gh([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repo}/issues/${pr}/timeline?per_page=100`,
    ])
      .flat()
      .filter(event =>
        [
          "head_ref_force_pushed",
          "head_ref_deleted",
          "head_ref_restored",
        ].includes(event?.event)
      ).length;

  let rewritten = 0;
  if (meta.state !== "OPEN") {
    rewritten = rewriteEvents();
    if (rewritten > 0) {
      process.stderr.write(
        `ci-verdict: ${rewritten} history-rewrite event(s); tail NOT CHECKABLE\n`
      );
      return 2;
    }
  }

  let stranded = 0;
  if (meta.state !== "OPEN" && meta.headRefOid && meta.headRefOid !== head) {
    // Fetched from the remote that HAS it: a fork's head is not on `origin`,
    // so asking the base repository throws before the count can be taken.
    execFileSync("git", ["fetch", headRemote, head], { stdio: "ignore" });

    stranded = execFileSync(
      "git",
      ["rev-list", "--count", `${meta.headRefOid}..${head}`],
      { encoding: "utf8" }
    ).trim();
    stranded = Number(stranded) || 0;
  }

  // Outside the range block deliberately. When the branch has NOT advanced the
  // work above is skipped, and that is exactly the case a push landing during
  // the timeline request turns into a false `ALREADY MERGED` — the condition
  // that would have caught it was evaluated from a read taken before the push.
  // The state is re-read for the same reason: a pull request closed mid-run
  // leaves every SHA and fingerprint identical, so nothing else here can see
  // it, and the verdict would be computed from a lifecycle that has changed.
  const settled = gh([
    "pr",
    "view",
    pr,
    "--repo",
    repoArg,
    "--json",
    "state,headRefOid",
  ]);
  if (headOf() !== head || settled.state !== meta.state) {
    process.stderr.write(
      "ci-verdict: head or pull-request state changed mid-run; re-run\n"
    );
    return 2;
  }

  // The rewrite evidence is re-read AFTER the final ref observation, because a
  // force-push away from `head` and back to it leaves every SHA identical while
  // recording an event that makes the tail uncheckable. An empty range from a
  // mutable ref is not proof that nothing was there — it is proof that nothing
  // is there NOW, and the timeline is the only record that the ref moved.
  if (meta.state !== "OPEN" && rewriteEvents() !== rewritten) {
    process.stderr.write(
      "ci-verdict: branch history rewritten mid-run; tail NOT CHECKABLE\n"
    );
    return 2;
  }

  const result = report({
    head,
    reviews,
    threads,
    issueComments,
    blocking,
    advisory,
    state: meta.state,
    stranded,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.exitCode;
}

// `import.meta.url` is percent-encoded AND realpath-resolved, so the comparison
// value has to be both. Interpolating the path leaves a `#` in a directory name
// unencoded, and skipping `realpathSync` leaves a symlinked prefix — `/tmp` is
// `/private/tmp` on macOS — unresolved. Either mismatch makes the gate exit 0
// having run nothing, which is the worst way for a gate to fail.
const invokedDirectly = () => {
  if (!process.argv[1]) return false;
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
};
if (invokedDirectly()) {
  main(process.argv.slice(2)).then(
    // `process.exitCode` rather than `process.exit`: the latter can terminate
    // before a piped or redirected stdout has drained, truncating the report
    // while still returning the intended status.
    code => {
      process.exitCode = code;
    },

    error => {
      process.stderr.write(`ci-verdict: ${error.message}\n`);
      process.exitCode = 2;
    }
  );
}
