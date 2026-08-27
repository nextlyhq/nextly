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
// A review object is not the only form a verdict takes. A reviewer may open one
// only when it has something to report, and state a clean pass as an issue
// comment naming the commit it read. Asking the reviews endpoint alone
// therefore yields nothing for a revision that was reviewed and passed, which
// is indistinguishable from one nobody looked at. Coverage is read from both
// places, and a comment counts only when it NAMES a revision that identifies
// the head unambiguously.
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
// Stating it precisely matters because the two halves fail differently. A
// pure function can only be wrong about the inputs it was given, and a test
// can give it any of them. The I/O half is wrong about the WORLD — a ref that
// moved, a history that is shallow, an entry point that did not match — and
// none of those is reachable by importing a function, so a suite that only
// imports can be green while the program does not run at all.

import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * A sibling module, resolved through this file's REAL path.
 *
 * A bare `./name.mjs` would be resolved relative to the specifier the runtime
 * holds for this module — and under `--preserve-symlinks-main` that is the
 * SYMLINK, so the sibling is looked for beside the link rather than beside
 * this file and the process dies before running. The same flag is why the
 * entry check below accepts two forms; this is its import-time half.
 *
 * EVERY sibling goes through here. A static import added later would reach the
 * one case this exists for — a symlinked entry under that flag — and fail with
 * `ERR_MODULE_NOT_FOUND` before any of this file runs, which turns the gate's
 * deliberate exit 2 into an exit 1.
 *
 * @param {string} name
 * @returns {Promise<Record<string, unknown>>}
 */
const sibling = name =>
  import(
    pathToFileURL(join(dirname(realpathSync(fileURLToPath(import.meta.url))), name))
      .href
  );

const { isCliEntry } = await sibling("cli-entry.mjs");
const evidence = await sibling("ci-verdict-evidence.mjs");
const {
  countStranded,
  createGh,
  headRemoteFor,
  readHeadSha,
  setupGitCredentials,
} = evidence;

/** Reviewers whose verdict blocks a merge, and the marker text of a refusal. */
export const RATE_LIMIT_MARKER = /Review limit reached/;

/**
 * Review states that represent an opinion its author has published.
 *
 * `PENDING` is an unsubmitted draft and `DISMISSED` has been explicitly
 * withdrawn, so neither is anybody saying anything about the revision.
 *
 * NAMED rather than excluded, which is the direction that fails closed.
 * Excluding one state grants coverage to every other — including `DISMISSED`,
 * which opens no thread, so a gate counting it reads clean on a revision whose
 * only review was withdrawn — and to any state added later that nobody here
 * has met.
 *
 * Exported because the merge-verification gate asks the same question, and two
 * lists of three strings agree until one of them is edited.
 */
export const SUBMITTED_REVIEW_STATES = Object.freeze([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
]);

/** Membership form of {@link SUBMITTED_REVIEW_STATES}, for the hot path. */
const SUBMITTED = new Set(SUBMITTED_REVIEW_STATES);

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
export function reviewersAtHead(reviews, head, since = undefined) {
  if (!Array.isArray(reviews) || typeof head !== "string" || head === "") {
    return [];
  }
  const seen = new Set();
  for (const review of reviews) {
    const login = review?.user?.login;
    // Only a SUBMITTED opinion is coverage. Allowing every state that is not
    // `PENDING` would count a withdrawn review, and a state this code has not
    // seen before would default to counting rather than to refusing.
    // A review submitted BEFORE the base last moved is evidence about a diff
    // that no longer exists. Its `commit_id` still names the current head, so
    // nothing about the revision gives it away — the base moved underneath it.
    // A review with no timestamp cannot be shown to postdate the change, and
    // unknown is not the same as covered.
    const withinScope =
      since === undefined ||
      (typeof review?.submitted_at === "string" && review.submitted_at > since);
    if (
      typeof login === "string" &&
      review?.commit_id === head &&
      SUBMITTED.has(review?.state) &&
      withinScope
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

/**
 * A verdict posted as an ISSUE COMMENT that names the commit it read.
 *
 * Some reviewers open a review object only when they have something to say, so
 * a clean pass arrives as an ordinary comment. Without this, such a verdict is
 * indistinguishable from no verdict at all.
 *
 * Coverage is granted only when the comment NAMES a revision and that revision
 * is the head. A comment that merely exists proves nothing: a reviewer that
 * comments on every round would otherwise have an older one certify whatever
 * was pushed after it.
 */
const REVIEWED_COMMIT_MARKER = /reviewed commit:\**\s*`([0-9a-f]{7,40})`/i;

/**
 * The revision a comment reports having read, or `undefined`.
 *
 * Exported because the merge-verification gate asks the same question of the
 * same comments, and two parsers for one format agree until one is edited. The
 * floor of seven characters is git's own for an abbreviation that identifies a
 * commit; below it the marker does not match at all, so a short string cannot
 * prefix many commits.
 */
export function reviewedCommitFrom(body) {
  if (typeof body !== "string") return undefined;
  return REVIEWED_COMMIT_MARKER.exec(body)?.[1]?.toLowerCase();
}

/**
 * Reviewer logins whose comment reports having read `head`.
 *
 * The abbreviation is matched as a PREFIX of the full head, which is the
 * relationship git's short form actually has. A floor of seven characters keeps
 * a short string from prefixing many commits; the marker must also be present,
 * so a comment quoting a SHA in passing does not count.
 *
 * Known boundary: a comment can be edited after the fact, so this trusts the
 * reviewer's account not to restate a revision it did not read. A review object
 * carries its `commit_id` from the server and cannot be rewritten that way, so
 * this source is the weaker of the two and is only ever additive to it.
 */
/**
 * When the base last moved, or `undefined` when it never has.
 *
 * Pure and exported so the merge-verification gate applies the SAME cutoff. A
 * verdict predating a base move describes a `base..head` diff that no longer
 * exists, and nothing about the revision gives that away, because the head did
 * not move. Takes the timeline as pages, which is how both callers hold it.
 */
export function latestBaseChange(pages) {
  const at = (Array.isArray(pages) ? pages : [])
    .flat()
    .filter(event => event?.event === "base_ref_changed")
    .map(event => event?.created_at)
    .filter(value => typeof value === "string")
    .sort();
  return at.length > 0 ? at[at.length - 1] : undefined;
}

/**
 * The pull request's revisions, or `undefined` when the list may be short.
 *
 * The commits endpoint serves at most 250 and reports no error when it
 * truncates, so a short list answers "no other revision shares this prefix"
 * from a sample. `reportedCount` is what the pull request says it has; without
 * it there is nothing to compare against and the set is withheld.
 *
 * Pure and exported so the WITHHOLDING is a property a test can hold inputs
 * against. Left inline in each command it is reachable only by the network.
 */
export function completeRevisionSet(shas, reportedCount) {
  if (!Array.isArray(shas) || typeof reportedCount !== "number") {
    return undefined;
  }
  const unique = [
    ...new Set(shas.filter(value => typeof value === "string")),
  ];
  return unique.length >= reportedCount ? unique : undefined;
}

export function abbreviationIsAmbiguous(named, head, knownRevisions) {
  // `knownRevisions` must be the pull request's COMPLETE revision set, or
  // absent. A partial set is worse than none: it answers "nothing else shares
  // this prefix" from a sample, so the caller decides completeness and passes
  // nothing when it cannot establish it.
  //
  // Nothing to compare against is not the same as nothing colliding, so an
  // absent set refuses rather than waving it through.
  if (knownRevisions === undefined || knownRevisions === null) return true;
  const target = head.toLowerCase();
  let sawTarget = false;
  for (const revision of knownRevisions) {
    if (typeof revision !== "string") continue;
    const candidate = revision.toLowerCase();
    if (candidate === target) {
      sawTarget = true;
      continue;
    }
    // A second revision of this pull request wearing the same prefix. The
    // author controls their own commits and a seven-digit prefix is within
    // reach of grinding, so a stale verdict about an earlier revision would
    // otherwise cover a head nobody read.
    if (candidate.startsWith(named)) return true;
  }
  // The head must be among the revisions checked. Where it is not, the set
  // says nothing about what this abbreviation identifies.
  return !sawTarget;
}

export function verdictCommentReviewers(
  issueComments,
  head,
  { since, knownRevisions, historyRewritten = false } = {}
) {
  if (
    !Array.isArray(issueComments) ||
    typeof head !== "string" ||
    head === ""
  ) {
    return [];
  }
  // A rewritten branch cannot supply the revisions to compare an abbreviation
  // against: the removed ones are gone from the commit list while a comment
  // naming one survives, so an abbreviation that looks unique among what
  // remains may identify a revision nobody can enumerate. A review record
  // still carries a full revision and is unaffected.
  if (historyRewritten) return [];
  const target = head.toLowerCase();
  const seen = new Set();
  for (const comment of issueComments) {
    const login = comment?.user?.login;
    const body = comment?.body;
    if (typeof login !== "string" || typeof body !== "string") continue;
    const named = reviewedCommitFrom(body);
    if (named === undefined || !target.startsWith(named)) continue;
    if (abbreviationIsAmbiguous(named, target, knownRevisions)) continue;
    // Same scoping rule the review objects get: a verdict predating the last
    // base move describes a diff that no longer exists, and a comment with no
    // timestamp cannot be shown to postdate it.
    // `updated_at` where there is one, because a reviewer that edits an existing
    // comment to name the newly reviewed revision has spoken about this
    // revision now, while the creation time still describes the older verdict.
    const stated = comment?.updated_at ?? comment?.created_at;
    const withinScope =
      since === undefined || (typeof stated === "string" && stated > since);
    if (withinScope) seen.add(login);
  }
  return [...seen].sort();
}

/**
 * Every reviewer that has covered `head`, from either source.
 *
 * One implementation, because the reported list and the missing list are the
 * same question asked twice: computing them apart lets a gate name a reviewer
 * as covering the head while still holding the merge for them.
 */
export function reviewersCovering(reviews, issueComments, head, options = {}) {
  return [
    ...new Set([
      ...reviewersAtHead(reviews, head, options.since),
      ...verdictCommentReviewers(issueComments, head, options),
    ]),
  ].sort();
}

/** Required reviewers with no verdict at `head`, in the order they were required. */
export function missingReviewers(
  reviews,
  issueComments,
  head,
  required,
  options = {}
) {
  const seen = new Set(reviewersCovering(reviews, issueComments, head, options));
  return (required ?? []).filter(login => !seen.has(login));
}

/** GitHub's `__typename` for a GitHub App's account, as opposed to a user. */
const BOT_TYPENAME = "Bot";

/** The suffix REST appends to a GitHub App's login, and GraphQL omits. */
const BOT_SUFFIX = "[bot]";

/**
 * Whether an actor's login can be read at all.
 *
 * A deleted account arrives as `author: null`, and a partial response can carry
 * the key with nothing in it. Neither is a login, and both must stay
 * distinguishable from one — every caller here counts what it cannot identify.
 */
const isReadableLogin = value => typeof value === "string" && value !== "";

/** Idempotent, so a login already in REST shape is returned unchanged. */
const withBotSuffix = login =>
  login.endsWith(BOT_SUFFIX) ? login : `${login}${BOT_SUFFIX}`;

/**
 * The REST-shaped login for an actor GraphQL described.
 *
 * GitHub spells one identity two ways. REST returns a GitHub App's account as
 * `<app-slug>[bot]`; GraphQL returns the bare slug and puts the account KIND in
 * `__typename`. Measured on this repository, one pull request, one minute:
 *
 * ```text
 * REST    pulls/1286/comments  .user.login  coderabbitai[bot]
 * GraphQL reviewThreads author .login       coderabbitai
 * GraphQL same node            .__typename  Bot
 * ```
 *
 * Reviewer configuration is written in the REST spelling — it is the one a
 * person reads off the pull request — so REST is the canonical form and the
 * GraphQL edge is reconciled to it. Reconciled ONCE, here, rather than at each
 * comparison: a normalisation every call site has to remember is one a call
 * site will eventually forget, and the failure is silent in both directions.
 *
 * **`__typename` is what makes appending the suffix safe, and it is doing a
 * different job from the login.** It answers *is this account a bot*, which no
 * account can present about itself, so a USER that registers the name
 * `coderabbitai` keeps its bare login and cannot borrow the app's identity. The
 * login answers *which* bot — the question the advisory policy actually asks.
 * Neither field can do the other's job: every reviewer here is a `Bot`, so
 * keying the policy on `__typename` alone would exempt the blocking reviewer
 * this gate exists to enforce.
 */
export function canonicalActorLogin(author) {
  const login = author?.login;
  if (!isReadableLogin(login)) return undefined;
  return author.__typename === BOT_TYPENAME ? withBotSuffix(login) : login;
}

/**
 * The review-thread page query.
 *
 * Built from {@link REVIEW_THREAD_NODE_FIELDS}, which `verify-merge.mjs` also
 * uses, so the two gates cannot ask GitHub for different fields. Restating the
 * selection there was the first version of this change: the shared count
 * delegates to `canonicalActorLogin`, so a future author field would be added
 * to this query while the copy stayed as it was, and the other gate would
 * silently receive incomplete data and disagree again — the very divergence
 * this change exists to close.
 *
 * Exported so a test can assert on the STRING THE CODE SENDS rather than on a
 * copy of it. The fields here and {@link canonicalActorLogin} are one decision
 * in two places: the canonicaliser reads `login` and `__typename`, and a
 * hand-built fixture supplies whatever field a test writes into it, so dropping
 * `__typename` from this selection breaks nothing any unit test can see. The
 * request would then return `undefined` for it, no thread would canonicalise to
 * a bot, no thread would ever be exempt, and every advisory thread would block —
 * which is the defect this query change exists to fix, reintroduced silently by
 * editing the query alone.
 */
export const REVIEW_THREAD_NODE_FIELDS =
  "isResolved comments(first:1){ nodes { author { login __typename } } }";

export const REVIEW_THREADS_QUERY =
  "query($pr:Int!,$owner:String!,$name:String!,$cursor:String){" +
  " repository(owner:$owner,name:$name){ pullRequest(number:$pr){" +
  " reviewThreads(first:100, after:$cursor){" +
  ` nodes { ${REVIEW_THREAD_NODE_FIELDS} }` +
  " pageInfo { hasNextPage endCursor } } } } }";

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
    const author = canonicalActorLogin(thread?.comments?.nodes?.[0]?.author);
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
  coverageSince = undefined,
  revisionOrder,
  revisionOrderComplete = false,
  knownRevisions = undefined,
  historyRewritten = false,
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
  // Taken from the revision SET, never from the order map. Ordering is withheld
  // where ancestry is not linear, and reusing it here would make a merge commit
  // anywhere in the pull request refuse every comment verdict.
  const coverageOptions = {
    since: coverageSince,
    knownRevisions,
    historyRewritten,
  };
  const covering = reviewersCovering(
    reviews,
    issueComments,
    head,
    coverageOptions
  );
  const missing = missingReviewers(
    reviews,
    issueComments,
    head,
    required,
    coverageOptions
  );
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
    reviewed_head: covering,
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
/**
 * A stamp over every field the decisions read, so the observation window can
 * tell whether the evidence moved underneath it.
 *
 * Exported so it can be asserted directly: it is the one input to the stability
 * check, and a field missing from it produces two equal stamps over different
 * evidence, which is a stale decision reported as a settled one.
 */
export const fingerprint = (rv, th, ic) =>
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
    // The parsed revision and the timestamp are read by the coverage decision,
    // so a comment edited in place from an older revision to the current one
    // moves this stamp. Recording only the id would leave two snapshots equal
    // while the evidence underneath them changed.
    ic.map(c => [
      c?.id,
      c?.user?.login,
      RATE_LIMIT_MARKER.test(c?.body ?? ""),
      reviewedCommitFrom(c?.body),
      c?.updated_at ?? c?.created_at,
    ]),
  ]);

/**
 * Which repository, on which host, from the environment.
 *
 * Pure, and exported so the parsing can be exercised without a request. It
 * decides where every later query is SENT, so getting it wrong describes one
 * repository while reading another — and until now the only way to run it was
 * to run the whole command.
 *
 * Returns `{ error }` rather than throwing or exiting, so the caller owns the
 * exit status and this stays callable from a test.
 */
export function resolveTarget(env = {}) {
  // `gh` defines GH_REPO as `[HOST/]OWNER/REPO`, so the owner is the
  // second-to-last segment rather than the first.
  const configured = env.GH_REPO ?? "nextlyhq/nextly";
  const segments = configured.split("/").filter(Boolean);
  if (segments.length < 2 || segments.length > 3) {
    return { error: "ci-verdict: GH_REPO must be [HOST/]OWNER/REPO\n" };
  }
  const [name] = segments.slice(-1);
  const [owner] = segments.slice(-2, -1);
  // `GH_HOST` supplies the hostname when GH_REPO does not carry one, which is
  // the ordinary Enterprise configuration. Defaulting straight to github.com
  // would override that selection with the explicit `--hostname` passed later.
  const host =
    segments.length === 3 ? segments[0] : (env.GH_HOST ?? "github.com");
  const repo = `${owner}/${name}`;
  return {
    owner,
    name,
    host,
    repo,
    // `--repo` is host-qualified off github.com, because a bare `owner/name`
    // there resolves against the public host whatever the API calls do.
    repoArg: host === "github.com" ? repo : `${host}/${repo}`,
  };
}

/**
 * The reviewer logins whose verdict blocks, and those merely reported.
 *
 * Trimmed: a list written with spaces after the commas yields entries that
 * match no login, and an unmatched blocking reviewer is silently dropped — the
 * gate then reports clean without that reviewer's coverage.
 *
 * An empty blocking set is returned as an error rather than as an empty array,
 * because "nobody blocks" makes every verdict clean and is far more likely to
 * be a mistyped variable than a decision.
 */
export function resolveReviewers(env = {}) {
  const logins = value =>
    value
      .split(",")
      .map(entry => entry.trim())
      .filter(Boolean);
  const blocking = logins(
    env.CI_VERDICT_BLOCKING ?? "chatgpt-codex-connector[bot]"
  );
  const advisory = logins(env.CI_VERDICT_ADVISORY ?? "coderabbitai[bot]");
  if (blocking.length === 0) {
    return { error: "ci-verdict: no blocking reviewer configured\n" };
  }
  return { blocking, advisory };
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
  const target = resolveTarget(process.env);
  if (target.error) {
    process.stderr.write(target.error);
    return 2;
  }
  const { owner, name, host, repo, repoArg } = target;
  const { execFileSync } = await import("node:child_process");
  setupGitCredentials({ exec: execFileSync, host });
  const gh = createGh({ exec: execFileSync, host });

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
    "headRefName,isCrossRepository,headRepositoryOwner,headRepository,state,headRefOid,baseRefOid",
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
  const headRemote = headRemoteFor(meta, { host, repo });

  const headOf = () =>
    readHeadSha({
      exec: execFileSync,
      headRemote,
      headRefName: meta.headRefName,
    });
  // A pull request CLOSED WITHOUT MERGING is settled by its lifecycle alone,
  // and its branch is commonly deleted straight afterwards — so resolving the
  // ref first turned a conclusive answer into `exit 2` for a missing ref.
  // Routed THROUGH `report` so every lifecycle emits one schema, then
  // overlaid: the evidence fields are replaced with "unavailable" because they
  // were never queried on this path. A second output shape would hand a
  // consumer reading `head` or `missing_reviews` a different object exactly
  // where it is least expecting one. Kept for the reader who assumes `report`
  // reviews and threads that cannot change this outcome.
  const reviewers = resolveReviewers(process.env);
  if (reviewers.error) {
    process.stderr.write(reviewers.error);
    return 2;
  }
  const { blocking, advisory } = reviewers;

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
  // Kept even where the ORDER is withheld. Ordering needs linear ancestry;
  // asking whether an abbreviation identifies more than one revision does not,
  // and folding the two together makes a single merge commit anywhere in the
  // pull request refuse every comment verdict.
  const knownRevisions = completeRevisionSet(
    commits.map(commit => commit?.sha),
    pullObject.commits
  );
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
        `query=${REVIEW_THREADS_QUERY}`,
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
  // The moment the base last moved, or `undefined` when it never has.
  // `base_ref_changed` is GitHub's own name for the event; there is no
  // structural alternative, because a review record carries no base of its own.
  const baseChangedAt = () =>
    latestBaseChange(
      gh([
        "api",
        "--paginate",
        "--slurp",
        `repos/${repo}/issues/${pr}/timeline?per_page=100`,
      ])
    );

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
      "state,headRefOid,baseRefOid",
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
      // A review is evidence about a DIFF, and the diff is base..head.
      // Retargeting a stacked pull request moves the base while the head SHA
      // stays put, so head equality alone would reuse reviews taken when the
      // parent stack was not in scope.
      base: live.baseRefOid,
      // Read inside the snapshot so a retarget landing mid-run moves the stamp
      // rather than silently widening the diff the verdict describes.
      baseChangedAt: baseChangedAt(),
      reviews: rv,
      threads: th,
      issueComments: ic,
      // A force-push away from a revision and back leaves every SHA identical
      // while recording an event, so the count belongs IN the snapshot rather
      // than beside it.
      // Read whatever the state, because comment evidence depends on it: a
      // rewritten branch no longer lists the revisions an abbreviation would
      // have to be unique against, and that is true of an open pull request
      // exactly as it is of a merged one.
      rewrites: rewriteEvents(),
    };
  };

  const stamp = s =>
    JSON.stringify([
      s.head,
      s.state,
      s.mergedHead,
      s.base,
      s.baseChangedAt,
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
  // The bracket is a FUNCTION rather than a sequence, so the ordering is
  // structural instead of a convention. `decide` runs between the two
  // observations because it is called between them; there is no arrangement of
  // statements elsewhere that moves the computation outside the window while
  // leaving this helper intact.
  //
  // Written this way after the ordering turned out to be untestable from
  // outside: the verdict is identical whether it is computed inside the window
  // or after it, so no assertion over the output can tell the two apart.
  const bracketed = decide => {
    const observed = snapshot();
    const outcome = decide(observed);
    return stamp(observed) === stamp(snapshot()) ? outcome : undefined;
  };

  let accepted;
  for (
    let attempt = 0;
    attempt < STABILITY_ATTEMPTS && !accepted;
    attempt += 1
  ) {
    let refusal;
    accepted = bracketed(observed => {
      if (
        observed.head !== head ||
        observed.state !== meta.state ||
        observed.base !== meta.baseRefOid
      ) {
        refusal =
          "ci-verdict: head, base or lifecycle moved since the first read; re-run\n";
        return undefined;
      }
      // ANY rewrite event disqualifies the tail check, so this compares against
      // zero rather than against a baseline taken earlier in the same run — a
      // baseline could only say "it did not move while I looked", which is the
      // weaker claim and the one an empty range already defeats.
      if (meta.state === "MERGED" && observed.rewrites > 0) {
        refusal = `ci-verdict: ${observed.rewrites} history-rewrite event(s); tail NOT CHECKABLE\n`;
        return undefined;
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
        // Both ends fetched from the remote that HAS them, and the checkout
        // deepened first where it is shallow — a truncated range reads as a
        // clean tail, which is what this count exists to disprove.
        stranded = countStranded({
          exec: execFileSync,
          headRemote,
          mergedHead: observed.mergedHead,
          head,
        });
      }

      return report({
        head,
        coverageSince: observed.baseChangedAt,
        knownRevisions,
        historyRewritten: observed.rewrites > 0,
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
    });
    if (refusal !== undefined) {
      process.stderr.write(refusal);
      return 2;
    }
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

// The guard is `cli-entry.mjs`, which documents why the comparison is made as a
// URL and why both the raw and the symlink-resolved form have to count. It is
// imported rather than restated so this gate cannot drift away from the scripts
// that share it, and the drift would be silent: a guard that answers wrongly
// leaves this file exiting 0 having run nothing.
if (isCliEntry(import.meta.url)) {
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
