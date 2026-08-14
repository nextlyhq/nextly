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
// What this measures is COVERAGE and OUTSTANDING WORK. It never measures
// whether a finding was addressed CORRECTLY, and no input here could tell it:
// a thread is resolved by whoever closes it, which is ordinarily the author,
// and the author is the party most likely to be wrong about their own fix. So
// a resolved thread carrying a false claim is indistinguishable here from one
// carrying a real one, and both count as zero. A clean verdict says a required
// reviewer read this revision and nothing is left open — never that the code
// is right.
//
// The EXPORTED decision helpers are pure: handed evidence, they return a
// verdict, so a caller can supply the inputs that must be got right. The
// command below owns all of the I/O — process, network, git and filesystem.
// That SPLIT is the claim; it is not a description of every function here.
//
// Stating it precisely matters. The pure half is covered by tests, the I/O
// half is not, and it is where this module's defects have actually lived: a
// head read from the wrong source, and three references left dangling by one
// block move — none of which a green suite could see.

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
 * Exit code for a verdict that REFUSES, as distinct from a failure to answer.
 *
 * Deliberately not 1. Node exits 1 for any uncaught exception — a missing
 * module, a bad import, a crash — so a caller reading 1 as "the pull request is
 * not ready" cannot tell that apart from "this program did not run", and
 * reports a considered verdict for a process that reached no code at all.
 */
export const EXIT_NOT_CLEAN = 10;

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
export function changesRequested(
  reviews,
  revisionOrder = undefined,
  revisionOrderComplete = false
) {
  if (!Array.isArray(reviews)) return [];
  // Ordered oldest first, so each account's later reviews decide what survives.
  const ordered = reviews
    .filter(review => typeof review?.user?.login === "string")
    .slice()
    .sort((a, b) =>
      `${a.submitted_at ?? ""}`.localeCompare(`${b.submitted_at ?? ""}`)
    );

  // Each account's objections are kept as a SET of revisions rather than as
  // one, because a second request for changes does not retire the first.
  // Reviews arrive out of order, so an objection against the head can be
  // followed by a delayed one naming an earlier commit; keeping only the most
  // recently written lets that delayed row displace the live objection, and an
  // approval of the earlier revision then clears an account still objecting to
  // what is being merged.
  const outstanding = new Map();
  // Revisions each account has approved, kept because clearance runs in both
  // directions. An approval answers the objections already on record, and it
  // also answers one that ARRIVES later while naming an earlier revision —
  // reviews are submitted out of order, so "already seen" is about the
  // revision, never about which row reached us first.
  const approvals = new Map();
  for (const review of ordered) {
    const login = review.user.login;
    // A COMMENTED review publishes feedback without withdrawing an objection,
    // so only an approval clears one. Treating any later review as clearance
    // lets a follow-up remark retire a request for changes nobody answered.
    //
    // A DISMISSED row is absent from both branches deliberately. Dismissal
    // invalidates THAT review, so a dismissed approval withdraws the clearance
    // rather than the objection — and a dismissed changes-request is already
    // represented by its own row no longer reading `CHANGES_REQUESTED`.
    if (review.state === "CHANGES_REQUESTED") {
      // Dropped rather than recorded when this account has ALREADY approved a
      // revision that covers it. The mirror of the clearing rule below: an
      // objection submitted after an approval but pinned to an earlier commit
      // describes code the approval already spoke for, and recording it would
      // report a reviewer as blocking a revision they signed off.
      // `strict`, because equality means opposite things in the two
      // directions. An approval naming the revision an objection already names
      // ANSWERS it — that approval arrived second. An objection naming the
      // revision an approval already names is the reviewer's NEWER position on
      // an unchanged tree, and suppressing it would report a blocking reviewer
      // as clean. Only a strictly newer approval pre-empts an objection.
      const answered = (approvals.get(login) ?? []).some(approvedAt =>
        approvalCovers(
          approvedAt,
          review.commit_id,
          revisionOrder,
          revisionOrderComplete,
          { strict: true }
        )
      );
      if (answered) continue;
      const objections = outstanding.get(login) ?? new Set();
      objections.add(review.commit_id);
      outstanding.set(login, objections);
    } else if (review.state === "APPROVED") {
      const seen = approvals.get(login) ?? [];
      seen.push(review.commit_id);
      approvals.set(login, seen);
      const objections = outstanding.get(login);
      if (objections === undefined) continue;
      for (const objectedAt of objections) {
        if (
          approvalCovers(
            review.commit_id,
            objectedAt,
            revisionOrder,
            revisionOrderComplete
          )
        ) {
          objections.delete(objectedAt);
        }
      }
      if (objections.size === 0) outstanding.delete(login);
    }
  }
  return [...outstanding.keys()].sort();
}

/**
 * Whether an approval of `approvedAt` answers an objection raised on
 * `objectedAt`.
 *
 * Decided from the pull request's own commit order rather than from
 * timestamps: reviews arrive out of order, so a later-SUBMITTED approval
 * pinned to an earlier revision says nothing about the objected one. Comparing
 * against the current head instead would resurrect a clearance every time the
 * head moves past the revision that made it.
 */
function approvalCovers(
  approvedAt,
  objectedAt,
  revisionOrder,
  revisionOrderComplete,
  { strict = false } = {}
) {
  // An approval naming the objected revision answers it whether or not either
  // is still in the order, which is what makes this the first question asked —
  // EXCEPT when the caller is asking the reverse question, whether a prior
  // approval pre-empts an objection that arrived later. There the same revision
  // means the objection is the newer word on an unchanged tree.
  if (approvedAt === objectedAt) return !strict;
  const at = revisionOrder?.get(approvedAt);
  const objected = revisionOrder?.get(objectedAt);
  // Absence from the order is read in ONE direction only, and the asymmetry is
  // the whole point. An approval on a revision the pull request no longer has
  // speaks to code that will not merge, so it answers nothing — while an
  // objection whose revision was replaced by a force-push or a rebase is
  // answered by an approval of the history that survived.
  //
  // Asked in this order so an order nobody could read stays conservative:
  // every revision is absent from an empty map, and clearing on the objection's
  // absence alone would turn a failed commit query into a blanket clearance.
  if (at === undefined) return false;
  // Reading absence as erasure requires the order to be COMPLETE, and the
  // caller must say so rather than have it assumed. GitHub serves at most 250
  // commits for one pull request and pagination cannot reach past that, so a
  // long history yields a map missing revisions nobody removed — and a
  // truncated order is indistinguishable from a rebased one by inspection.
  // Defaulting to incomplete keeps the unstated case on the side that refuses,
  // because a caller that never supplied the flag has not established the
  // property it would otherwise be read as asserting.
  if (objected === undefined) return revisionOrderComplete === true;
  return strict ? at > objected : at >= objected;
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
      exitCode: stranded > 0 ? EXIT_NOT_CLEAN : 0,
    };
  }
  // Closed without merging is a refusal, not a completion. Sharing the merged
  // branch would report success for a pull request whose work never landed.
  if (state !== "OPEN") {
    return {
      verdict: "CLOSED WITHOUT MERGING",
      detail: { state, unmergedCandidates: stranded },
      exitCode: EXIT_NOT_CLEAN,
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
      exitCode: EXIT_NOT_CLEAN,
    };
  }
  if (blockingMissing.length > 0) {
    return {
      verdict: "MISSING REVIEW AT HEAD",
      detail: blockingMissing,
      exitCode: EXIT_NOT_CLEAN,
    };
  }
  // Checked alongside open threads rather than after them, because a review
  // stating its case in the body opens none: thread resolution cannot see it.
  if (blockingRefused.length > 0) {
    return {
      verdict: "CHANGES REQUESTED",
      detail: blockingRefused,
      exitCode: EXIT_NOT_CLEAN,
    };
  }
  if (unresolved > 0) {
    return {
      verdict: "UNRESOLVED THREADS",
      detail: unresolved,
      exitCode: EXIT_NOT_CLEAN,
    };
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
  revisionOrder,
  revisionOrderComplete = false,
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
  // Clearance is decided from the REVISION ORDER, never from the head. An
  // objection spans revisions — pushing a commit does not answer it — while
  // whether an approval supersedes one is a question about which revision that
  // approval spoke to. The head appears only inside `orderReachesHead`, which
  // withholds the order entirely unless it reaches the revision being judged.
  // Completeness is re-established HERE rather than taken on the caller's word,
  // because a count cannot establish it. A branch force-pushed to a different
  // history of the same length and restored before the later ref reads leaves a
  // map that satisfies every size comparison while describing revisions that
  // are not the ones being merged — and the head's absence from it is the thing
  // that gives that away. An order that does not reach the revision under
  // judgement cannot license reading any other absence as erasure.
  // The head must be the FINAL revision, not merely present. A branch that
  // fast-forwards to an already-reviewed child during the commit request and
  // returns before every ref recheck yields an order that contains the head and
  // continues past it — so a delayed approval pinned to that child would clear
  // an objection at the head, while the child is not what merges. Presence
  // alone cannot separate that from an order taken while the branch was still.
  const finalIndex = revisionOrder ? revisionOrder.size - 1 : -1;
  const orderReachesHead =
    revisionOrderComplete === true && revisionOrder?.get(head) === finalIndex;
  const refused = changesRequested(reviews, revisionOrder, orderReachesHead);
  const { verdict, detail, exitCode } = verdictFor({
    missing,
    unresolved,
    limited,
    refused,
    blocking,
    state,
    stranded,
  });

  // The verdict leads, and the evidence follows it. Serialised last, these
  // three sit below every list in the printed object, so a reader that pipes
  // the output through `head` — or any pager, or a chat window that truncates —
  // sees the supporting counts and not the refusal they support. The counts are
  // individually reassuring, `unresolved_threads: 0` most of all, so a cut-off
  // read does not look partial. Order is not a substitute for the exit status,
  // which is the only channel a filter cannot silently drop; it removes the
  // case where a truncated view is actively misleading rather than merely
  // incomplete.
  return {
    verdict,
    exitCode,
    detail,
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
  };
}

/**
 * A comparable value for everything volatile in a review snapshot.
 *
 * Compared by CONTENT rather than by count: a body-only `CHANGES_REQUESTED`
 * arriving between two reads, or an existing thread being unresolved, leaves
 * every array length unchanged — so a length check accepts a snapshot that has
 * already gone stale and only ever catches the shape of change it was written
 * for. Issue comments are included because the rate-limit marker is EDITED IN
 * PLACE: a blocking reviewer can add or remove it with no review submitted and
 * no ref moving, leaving every other signal identical while the verdict flips.
 *
 * Module scope deliberately. It closes over nothing but `RATE_LIMIT_MARKER`,
 * and defining it inside the command tied its lifetime to one block — which is
 * how a later rearrangement of that block took the definition with it.
 */
const fingerprint = (rv, th, ic) =>
  JSON.stringify([
    // Every field a decision function READS, so the stamp cannot hold still
    // while an input to the verdict moves. `submitted_at` is here because
    // `changesRequested` orders reviews by it; omitting it made this a second,
    // narrower notion of "the evidence changed" than the verdict's own.
    rv.map(r => [
      r?.id,
      r?.user?.login,
      r?.commit_id,
      r?.state,
      r?.submitted_at,
    ]),
    th.map(t => [t?.isResolved, t?.comments?.nodes?.[0]?.author?.login]),
    ic.map(c => [c?.id, c?.user?.login, RATE_LIMIT_MARKER.test(c?.body ?? "")]),
  ]);

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
  // `git` does not read GH_TOKEN, and the workflow checks out with
  // `persist-credentials: false`, so `ls-remote` against a private repository
  // would fail after the API lookups had already succeeded. This points git at
  // the same credentials `gh` is using.
  try {
    execFileSync("gh", ["auth", "setup-git", "--hostname", host], {
      stdio: "ignore",
    });
  } catch {
    // Unauthenticated public access still works; a private repository fails
    // later at `ls-remote`, with a message naming the ref it could not read.
  }
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
  // A pull request CLOSED WITHOUT MERGING is settled by its lifecycle alone,
  // and its branch is commonly deleted straight afterwards — so resolving the
  // ref first turned a conclusive answer into `exit 2` for a missing ref.
  // Routed THROUGH `report` so every lifecycle emits one schema, then
  // overlaid: the evidence fields are replaced with "unavailable" because they
  // were never queried on this path. A second output shape would hand a
  // consumer reading `head` or `missing_reviews` a different object exactly
  // where it is least expecting one. Kept for the reader who assumes `report`
  // reviews and threads that cannot change this outcome.
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

  if (meta.state !== "OPEN" && meta.state !== "MERGED") {
    // Re-read immediately before emitting. This path takes no other remote
    // observation, so without it the verdict rests on a lifecycle sampled
    // earlier in the run — and reopening is precisely the transition that makes
    // "closed without merging" wrong. Read from the pull request rather than
    // the ref, because a closed branch is commonly deleted.
    const stillClosed = gh([
      "pr",
      "view",
      pr,
      "--repo",
      repoArg,
      "--json",
      "state",
    ]).state;
    if (stillClosed !== meta.state) {
      process.stderr.write(
        `ci-verdict: lifecycle changed ${meta.state} -> ${stillClosed}; re-run\n`
      );
      return 2;
    }
    // Through the SHARED serializer, so every lifecycle emits one schema. A
    // second output shape for one state means a consumer reading `head` or
    // `missing_reviews` gets a different object exactly where it is least
    // expecting one.
    const closed = report({
      head: meta.headRefOid ?? "",
      reviews: [],
      threads: [],
      issueComments: [],
      blocking,
      advisory,
      state: meta.state,
      stranded: 0,
    });
    // The review evidence was never QUERIED for a closed pull request, so the
    // empty collections above are an artefact of the shortcut rather than an
    // observation. Serialized as unavailable so a consumer cannot read
    // "nothing outstanding" from a question nobody asked.
    process.stdout.write(
      `${JSON.stringify(
        {
          ...closed,
          reviewed_head: "unavailable",
          missing_reviews: "unavailable",
          unresolved_threads: "unavailable",
          rate_limited: "unavailable",
          changes_requested: "unavailable",
        },
        null,
        2
      )}\n`
    );
    return closed.exitCode;
  }

  const head = headOf();
  const reviews = gh([
    "api",
    `repos/${repo}/pulls/${pr}/reviews`,
    "--paginate",
    "--slurp",
  ]).flat();
  // The pull request's own commit ORDER, which is what decides whether one
  // review's revision is later than another's. Timestamps cannot: reviews
  // arrive out of order, and the current head is a moving target that
  // resurrects a clearance as soon as it advances past the revision that made
  // it.
  // The pull request object carries its commit TOTAL as a number, which the
  // commit listing cannot report about itself: a truncated list looks exactly
  // like a complete one of that length.
  const pullObject = gh(["api", `repos/${repo}/pulls/${pr}`]);
  const commits = gh([
    "api",
    `repos/${repo}/pulls/${pr}/commits`,
    "--paginate",
    "--slurp",
  ]).flat();
  // A list POSITION is only a stand-in for ancestry while the history is
  // linear. Once the pull request contains a merge, two commits on sibling
  // sides have positions that compare while neither contains the other — so an
  // approval with the higher index can "cover" an objection whose code the
  // approved tree never held.
  //
  // Rather than infer ancestry from an order that cannot express it, the order
  // is WITHHELD entirely: every rank lookup then misses, and the existing
  // conservative path leaves identity as the only thing that clears an
  // objection. Fewer clearances, never a wrong one — and no second notion of
  // coverage to keep in step with the first.
  //
  // `parents` already rides along on the commits payload, so this costs no
  // extra request.
  const linearHistory = commits.every(
    commit => (commit?.parents?.length ?? 1) <= 1
  );
  if (!linearHistory) {
    process.stderr.write(
      "ci-verdict: merge commit in the pull request; revision ORDER withheld, " +
        "so only an approval naming the objected revision clears it\n"
    );
  }
  const revisionOrder = linearHistory
    ? new Map(commits.map((commit, index) => [commit.sha, index]))
    : undefined;
  // GitHub serves at most 250 commits from that endpoint and `--paginate`
  // cannot reach past it, returning a short list and no error. Compared against
  // the map's SIZE rather than the array's length, because a duplicate sha
  // would inflate the array while collapsing in the Map and make a truncated
  // history read as complete.
  const revisionOrderComplete =
    revisionOrder !== undefined &&
    typeof pullObject.commits === "number" &&
    revisionOrder.size >= pullObject.commits;
  if (!revisionOrderComplete) {
    const total =
      typeof pullObject.commits === "number" ? pullObject.commits : "unknown";
    process.stderr.write(
      `ci-verdict: commit order incomplete (${revisionOrder?.size ?? 0} of ${total}); ` +
        `an objection on a revision absent from it will NOT be cleared\n`
    );
  }
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
  // EVERY volatile input, read together and compared as one value.
  //
  // Separately ordered reads cannot form an atomic snapshot, whatever order
  // they are put in. The head, the lifecycle, the reviews, the threads, the
  // issue comments and the rewrite events each move independently of the
  // others, so whichever is read last leaves every earlier one unverified at
  // the moment the verdict is computed — and making a different one last only
  // moves which is stale.
  //
  // Requiring two CONSECUTIVE observations to agree removes the ordering
  // question rather than answering it: the snapshot the verdict is computed
  // from is bracketed by an identical one taken after it, so nothing the
  // verdict depends on changed across the window in which it was decided.
  // A branch force-pushed, deleted or restored cannot certify its own tail:
  // resetting it back to the merged head leaves an empty range indistinguishable
  // from a branch that never advanced. Counted rather than inspected, because
  // the timeline records that the ref moved and not what it moved away from.
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

  const snapshot = () => {
    const live = gh([
      "pr",
      "view",
      pr,
      "--repo",
      repoArg,
      "--json",
      "state,headRefOid",
    ]);
    const rv = gh([
      "api",
      `repos/${repo}/pulls/${pr}/reviews`,
      "--paginate",
      "--slurp",
    ]).flat();
    const ic = gh([
      "api",
      `repos/${repo}/issues/${pr}/comments`,
      "--paginate",
      "--slurp",
    ]).flat();
    const th = readThreads();
    return {
      head: headOf(),
      state: live.state,
      mergedHead: live.headRefOid,
      reviews: rv,
      threads: th,
      issueComments: ic,
      // A force-push away from a revision and back leaves every SHA identical
      // while recording an event, so the count belongs IN the snapshot rather
      // than beside it.
      rewrites: live.state === "MERGED" ? rewriteEvents() : 0,
    };
  };

  const stamp = s =>
    JSON.stringify([
      s.head,
      s.state,
      s.mergedHead,
      s.rewrites,
      fingerprint(s.reviews, s.threads, s.issueComments),
    ]);

  // Bounded, because a repository under continuous activity would otherwise
  // retry forever. Exhausting the attempts is a refusal to answer rather than a
  // verdict: the state genuinely would not hold still.
  const STABILITY_ATTEMPTS = 3;

  // The verdict is computed INSIDE the window, not after it.
  //
  // Settling a snapshot and then continuing is not a bracket: every request
  // made between the agreement and `report()` is a gap the agreement does not
  // cover, and a reviewer submitting `CHANGES_REQUESTED` or unresolving a
  // thread in it produces a CLEAN verdict from arrays already known to be old.
  // Ordering cannot fix it: independently mutable reads do not become atomic
  // by being sequenced, so whichever is placed last simply moves which of the
  // others is stale when the verdict is formed.
  //
  // Each attempt therefore observes, judges from THAT observation, and observes
  // again. The candidate is emitted only when the second observation matches
  // the first, so the whole computation — the lifecycle checks, the stranded
  // count and `report()` — sits between two identical readings of everything
  // it consumed.
  let accepted;
  for (
    let attempt = 0;
    attempt < STABILITY_ATTEMPTS && !accepted;
    attempt += 1
  ) {
    const observed = snapshot();

    if (observed.head !== head || observed.state !== meta.state) {
      process.stderr.write(
        "ci-verdict: head or lifecycle moved since the first read; re-run\n"
      );
      return 2;
    }
    // ANY rewrite event disqualifies the tail check, so this compares against
    // zero rather than against a baseline taken earlier in the same run — a
    // baseline could only say "it did not move while I looked", which is the
    // weaker claim and the one an empty range already defeats.
    if (meta.state === "MERGED" && observed.rewrites > 0) {
      process.stderr.write(
        `ci-verdict: ${observed.rewrites} history-rewrite event(s); tail NOT CHECKABLE\n`
      );
      return 2;
    }

    // A merged pull request keeps a branch that can still be pushed to while
    // GitHub freezes `headRefOid` at the revision that merged, so commits after
    // that point are in neither and would otherwise go unnoticed.
    let stranded = 0;
    if (
      meta.state === "MERGED" &&
      observed.mergedHead &&
      observed.mergedHead !== head
    ) {
      // Both ends fetched from the remote that HAS them: the workflow checks
      // out shallow, and after a squash the merged head is commonly absent.
      // A shallow checkout keeps its boundary in `.git/shallow`, and fetching
      // two more objects does not remove it — so `rev-list` stops at the
      // boundary and reports a SHORT count rather than failing. That is the
      // reassuring direction: a truncated range reads as a clean tail, which is
      // exactly what this count exists to disprove.
      //
      // Deepened only when the repository is actually shallow, because
      // `--unshallow` errors on a complete one.
      const isShallow =
        execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
          encoding: "utf8",
        }).trim() === "true";
      execFileSync(
        "git",
        [
          "fetch",
          ...(isShallow ? ["--unshallow"] : []),
          headRemote,
          head,
          observed.mergedHead,
        ],
        { stdio: "ignore" }
      );
      stranded =
        Number(
          execFileSync(
            "git",
            ["rev-list", "--count", `${observed.mergedHead}..${head}`],
            { encoding: "utf8" }
          ).trim()
        ) || 0;
    }

    const candidate = report({
      head,
      revisionOrder,
      revisionOrderComplete,
      reviews: observed.reviews,
      threads: observed.threads,
      issueComments: observed.issueComments,
      blocking,
      advisory,
      state: meta.state,
      stranded,
    });

    // The closing observation. Only an unchanged world licenses the candidate.
    if (stamp(observed) === stamp(snapshot())) accepted = candidate;
  }

  if (!accepted) {
    process.stderr.write(
      `ci-verdict: state moved during every one of ${STABILITY_ATTEMPTS} attempts; re-run\n`
    );
    return 2;
  }

  process.stdout.write(`${JSON.stringify(accepted, null, 2)}\n`);
  return accepted.exitCode;
}

// `import.meta.url` is percent-encoded AND realpath-resolved, so the comparison
// value has to be both. Interpolating the path leaves a `#` in a directory name
// unencoded, and skipping `realpathSync` leaves a symlinked prefix — `/tmp` is
// `/private/tmp` on macOS — unresolved. Either mismatch makes the gate exit 0
// having run nothing, which is the worst way for a gate to fail.
// BOTH forms are compared, because which one `import.meta.url` carries depends
// on a runtime flag rather than on this file. `--preserve-symlinks-main` (which
// `NODE_OPTIONS` can supply from outside the command line) keeps the symlink in
// `import.meta.url`, while `realpathSync` resolves it away — so a resolve-only
// comparison fails to match when the gate is invoked through a symlink under
// that flag, and the process exits 0 having executed nothing.
const invokedDirectly = () => {
  if (!process.argv[1]) return false;
  const entries = new Set();
  for (const path of [process.argv[1], resolvedEntry(process.argv[1])]) {
    if (path === undefined) continue;
    try {
      entries.add(pathToFileURL(path).href);
    } catch {
      // A path that cannot be expressed as a file URL is not this module.
    }
  }
  return entries.has(import.meta.url);
};

/** The symlink-resolved form of `path`, or `undefined` when it cannot be read. */
const resolvedEntry = path => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
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
