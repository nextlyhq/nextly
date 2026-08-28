import { describe, expect, it } from "vitest";

import {
  EXIT_NOT_CLEAN,
  REVIEW_THREADS_QUERY,
  REVIEW_THREAD_NODE_FIELDS,
  advisoryExemptions,
  canonicalActorLogin,
  changesRequested,
  completeRevisionSet,
  fingerprint,
  missingReviewers,
  rateLimited,
  report,
  resolveReviewers,
  resolveTarget,
  reviewersAtHead,
  reviewersCovering,
  unresolvedThreads,
  verdictCommentReviewers,
  verdictFor,
} from "./ci-verdict.mjs";

const CODEX = "chatgpt-codex-connector[bot]";
const RABBIT = "coderabbitai[bot]";
const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
/** A revision a force-push removed, so the pull request's order lacks it. */
const ERASED = "dddddddddddddddddddddddddddddddddddddddd";

/** The pull request's commit order, which is what decides "later revision". */
const ORDER = new Map([
  [OLD, 0],
  [HEAD, 1],
]);

/** A submitted review, which is the ordinary case the other fixtures vary from. */
const review = (login, commit_id, id = 1) => ({
  id,
  user: { login },
  commit_id,
  state: "COMMENTED",
});

/** A pull request that is otherwise clean, so one varied field decides. */
const BASE = {
  head: HEAD,
  revisionOrder: ORDER,
  reviews: [review(CODEX, HEAD)],
  threads: [],
  issueComments: [],
  blocking: [CODEX],
  advisory: [RABBIT],
};

/**
 * A clean verdict as its author actually posts one: an issue comment naming the
 * commit it read, in the abbreviated form, with no review object anywhere.
 */
const verdictComment = (login, sha, created_at = undefined) => ({
  user: { login },
  body: `Codex Review: Didn't find any major issues. Keep it up!\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\`\n`,
  ...(created_at === undefined ? {} : { created_at }),
});

/**
 * Coverage from a reviewer that states a clean pass WITHOUT a review object.
 *
 * The fixture carries no review record at all, which is the point: a reviewer
 * may open one only when it has findings, so a gate reading records alone
 * cannot tell a clean verdict from silence. Every case below fixes what a
 * comment must carry before it counts as coverage.
 */
describe("verdictCommentReviewers", () => {
  it("grants coverage from a comment naming the head", () => {
    expect(
      verdictCommentReviewers([verdictComment(CODEX, HEAD)], HEAD, {
        knownRevisions: [HEAD],
      })
    ).toEqual([CODEX]);
  });

  it("ignores a verdict naming a different revision", () => {
    expect(
      verdictCommentReviewers([verdictComment(CODEX, OLD)], HEAD, {
        knownRevisions: [HEAD],
      })
    ).toEqual([]);
  });

  it("ignores a comment with no commit named", () => {
    const chatter = { user: { login: CODEX }, body: "Working on it." };
    expect(verdictCommentReviewers([chatter], HEAD)).toEqual([]);
  });

  // The abbreviation is a PREFIX of the head, so a floor keeps a short string
  // from prefixing many commits. Below it the marker must not match at all.
  it("refuses an abbreviation shorter than seven characters", () => {
    const stubby = {
      user: { login: CODEX },
      body: "**Reviewed commit:** `aaaaaa`",
    };
    expect(verdictCommentReviewers([stubby], HEAD)).toEqual([]);
  });

  it("matches the COMPLETE login, so a lookalike cannot self-certify", () => {
    const seen = verdictCommentReviewers(
      [verdictComment("codex-impersonator", HEAD)],
      HEAD
    );
    expect(seen).not.toContain(CODEX);
  });

  it("excludes a verdict predating the last base move", () => {
    const stale = verdictComment(CODEX, HEAD, "2026-08-14T09:00:00Z");
    expect(
      verdictCommentReviewers([stale], HEAD, {
        since: "2026-08-14T10:00:00Z",
        knownRevisions: [HEAD],
      })
    ).toEqual([]);
  });

  it("counts a verdict after the last base move", () => {
    const fresh = verdictComment(CODEX, HEAD, "2026-08-14T11:00:00Z");
    expect(
      verdictCommentReviewers([fresh], HEAD, {
        since: "2026-08-14T10:00:00Z",
        knownRevisions: [HEAD],
      })
    ).toEqual([CODEX]);
  });

  // A reviewer that edits an existing comment to name the newly reviewed
  // revision has spoken NOW, while the creation time still describes the older
  // verdict.
  it("counts a verdict RESTATED after the base moved", () => {
    const edited = {
      ...verdictComment(CODEX, HEAD, "2026-08-14T09:00:00Z"),
      updated_at: "2026-08-14T11:00:00Z",
    };
    expect(
      verdictCommentReviewers([edited], HEAD, {
        since: "2026-08-14T10:00:00Z",
        knownRevisions: [HEAD],
      })
    ).toEqual([CODEX]);
  });

  // A comment with no timestamp cannot be shown to postdate the base move, and
  // unknown is not the same as covered.
  it("excludes an undated verdict once a base move is in scope", () => {
    expect(
      verdictCommentReviewers([verdictComment(CODEX, HEAD)], HEAD, {
        since: "2026-08-14T10:00:00Z",
        knownRevisions: [HEAD],
      })
    ).toEqual([]);
  });

  // An abbreviation is evidence only if it identifies ONE commit. The author
  // controls their own commits and seven hexadecimal digits is within reach of
  // grinding, so a head sharing a prefix with an earlier reviewed revision
  // would otherwise be covered by that older verdict.
  it("refuses an abbreviation that also matches an earlier revision", () => {
    const shared = "aaaaaaa";
    const collidingHead = shared + "1".repeat(40 - shared.length);
    const olderRevision = shared + "2".repeat(40 - shared.length);
    const comment = {
      user: { login: CODEX },
      body: `**Reviewed commit:** \`${shared}\``,
    };
    expect(
      verdictCommentReviewers([comment], collidingHead, {
        knownRevisions: [collidingHead, olderRevision],
      })
    ).toEqual([]);
  });

  // Nothing to compare against is not the same as nothing colliding.
  it("refuses when no revision set is supplied", () => {
    expect(verdictCommentReviewers([verdictComment(CODEX, HEAD)], HEAD)).toEqual(
      []
    );
  });

  it("refuses when the head is absent from the revision set", () => {
    expect(
      verdictCommentReviewers([verdictComment(CODEX, HEAD)], HEAD, {
        knownRevisions: [OLD],
      })
    ).toEqual([]);
  });

  // A rewritten branch no longer lists the revisions an abbreviation must be
  // unique against, while a comment naming a removed one survives.
  it("refuses every comment verdict once history was rewritten", () => {
    expect(
      verdictCommentReviewers([verdictComment(CODEX, HEAD)], HEAD, {
        knownRevisions: [HEAD],
        historyRewritten: true,
      })
    ).toEqual([]);
  });

  // A caller that cannot establish completeness passes nothing, so a truncated
  // history cannot answer "no other revision shares this prefix" from a sample.
  it("refuses when the revision set omits a colliding revision", () => {
    const shared = "aaaaaaa";
    const collidingHead = shared + "1".repeat(40 - shared.length);
    const comment = {
      user: { login: CODEX },
      body: `**Reviewed commit:** \`${shared}\``,
    };
    // The omitted revision is absent from the set exactly as truncation leaves
    // it, so the head alone would look unanimous.
    expect(
      verdictCommentReviewers([comment], collidingHead, {
        knownRevisions: undefined,
      })
    ).toEqual([]);
  });

  it("survives absent or malformed input", () => {
    expect(verdictCommentReviewers(undefined, HEAD)).toEqual([]);
    expect(verdictCommentReviewers([verdictComment(CODEX, HEAD)], "")).toEqual(
      []
    );
  });
});

describe("completeRevisionSet", () => {
  const A = "a".repeat(40);
  const B = "b".repeat(40);

  it("returns the revisions when every one was seen", () => {
    expect(completeRevisionSet([A, B], 2)).toEqual([A, B]);
  });

  // The endpoint truncates without erroring, so a short list is the shape a
  // long history arrives in. Withholding is what stops the uniqueness question
  // being answered from a sample.
  it("withholds a set shorter than the count reported", () => {
    expect(completeRevisionSet([A], 2)).toBeUndefined();
  });

  it("withholds when the count is unavailable", () => {
    expect(completeRevisionSet([A, B], undefined)).toBeUndefined();
  });

  // Compared by DISTINCT revisions: a duplicate would otherwise pad the length
  // and make a truncated list reach the reported total.
  it("counts distinct revisions rather than entries", () => {
    expect(completeRevisionSet([A, A], 2)).toBeUndefined();
  });

  it("drops entries that are not revisions rather than counting them", () => {
    expect(completeRevisionSet([A, undefined, null], 2)).toBeUndefined();
  });

  it("survives input that is not a list", () => {
    expect(completeRevisionSet(undefined, 2)).toBeUndefined();
  });
});

describe("fingerprint", () => {
  // A comment edited in place keeps its id, so a stamp recording only the id
  // holds still while the revision it names changes. Both snapshots then
  // compare equal and a decision taken over the OLD evidence is reported as
  // settled.
  it("moves when a comment is edited to name a different revision", () => {
    const before = [
      { id: 7, user: { login: CODEX }, body: "**Reviewed commit:** `bbbbbbbbbb`" },
    ];
    const after = [
      { id: 7, user: { login: CODEX }, body: "**Reviewed commit:** `aaaaaaaaaa`" },
    ];
    expect(fingerprint([], [], before)).not.toEqual(fingerprint([], [], after));
  });

  it("moves when a comment is edited without changing the named revision", () => {
    const before = [
      {
        id: 7,
        user: { login: CODEX },
        body: "**Reviewed commit:** `aaaaaaaaaa`",
        updated_at: "2026-08-14T09:00:00Z",
      },
    ];
    const after = [
      {
        id: 7,
        user: { login: CODEX },
        body: "**Reviewed commit:** `aaaaaaaaaa`",
        updated_at: "2026-08-14T11:00:00Z",
      },
    ];
    expect(fingerprint([], [], before)).not.toEqual(fingerprint([], [], after));
  });

  // The control: identical evidence must produce an identical stamp, or the
  // window never settles and every run exhausts its attempts.
  it("holds still over identical evidence", () => {
    const same = [
      { id: 7, user: { login: CODEX }, body: "**Reviewed commit:** `aaaaaaaaaa`" },
    ];
    expect(fingerprint([], [], same)).toEqual(fingerprint([], [], [...same]));
  });
});

describe("reviewersCovering", () => {
  it("unions both sources without repeating a reviewer present in each", () => {
    expect(
      reviewersCovering(
        [review(CODEX, HEAD)],
        [verdictComment(CODEX, HEAD)],
        HEAD,
        { knownRevisions: [HEAD] }
      )
    ).toEqual([CODEX]);
  });

  it("clears a required reviewer that only ever commented", () => {
    expect(
      missingReviewers([], [verdictComment(CODEX, HEAD)], HEAD, [CODEX], {
        knownRevisions: [HEAD],
      })
    ).toEqual([]);
  });
});

describe("reviewersAtHead", () => {
  it("reports a reviewer that submitted at the head", () => {
    expect(reviewersAtHead([review(CODEX, HEAD)], HEAD)).toEqual([CODEX]);
  });

  /**
   * The control for the case above: without it, a function returning every
   * reviewer regardless of commit would satisfy it, and that is precisely the
   * defect being guarded — a verdict inherited from a revision nobody is
   * merging.
   */
  it("does not report a reviewer whose only review is on an earlier commit", () => {
    expect(reviewersAtHead([review(CODEX, OLD)], HEAD)).toEqual([]);
  });

  /**
   * Reviewers disagree about what a review object is: one posts a single object
   * per round carrying many comments, another posts one object per finding.
   * Coverage must read the same either way, which is the property that makes
   * counting objects safe HERE and unsafe as a measure of outstanding work.
   */
  it("reads the same whether a reviewer posts one object or many", () => {
    const one = [review(RABBIT, HEAD, 1)];
    const many = [1, 2, 3, 4, 5, 6].map(id => review(RABBIT, HEAD, id));
    expect(reviewersAtHead(many, HEAD)).toEqual(reviewersAtHead(one, HEAD));
  });

  it("treats a login that merely contains a reviewer's name as a different account", () => {
    const seen = reviewersAtHead([review("codex-impersonator", HEAD)], HEAD);
    expect(seen).not.toContain(CODEX);
    expect(
      missingReviewers([review("codex-impersonator", HEAD)], [], HEAD, [CODEX])
    ).toEqual([CODEX]);
  });

  /**
   * A submitted review and an unsubmitted draft are different events. Counting
   * the draft reports coverage its author never gave.
   */
  it("does not count a PENDING review as coverage", () => {
    expect(
      reviewersAtHead([{ ...review(CODEX, HEAD), state: "PENDING" }], HEAD)
    ).toEqual([]);
    expect(
      reviewersAtHead([{ ...review(CODEX, HEAD), state: "COMMENTED" }], HEAD)
    ).toEqual([CODEX]);
  });

  /**
   * Retargeting a stacked pull request moves the BASE while the head SHA stays
   * put, so the reviewed diff widens under a revision that never changed. A
   * review predating that carries the current head in `commit_id` and is still
   * evidence about a diff that no longer exists — nothing about the revision
   * gives it away, which is why coverage needs a lower bound as well.
   */
  it("does not count a review submitted before the base last moved", () => {
    const stale = {
      ...review(CODEX, HEAD),
      submitted_at: "2026-08-14T09:00:00Z",
    };
    expect(reviewersAtHead([stale], HEAD, "2026-08-14T10:00:00Z")).toEqual([]);
    // The positive control: the same review, submitted after the retarget.
    const fresh = {
      ...review(CODEX, HEAD),
      submitted_at: "2026-08-14T11:00:00Z",
    };
    expect(reviewersAtHead([fresh], HEAD, "2026-08-14T10:00:00Z")).toEqual([
      CODEX,
    ]);
  });

  /**
   * No bound means no pull request has been retargeted, which must not quietly
   * become "nothing counts" — the ordinary case has no `submitted_at` bound to
   * clear at all.
   */
  it("counts a review normally when the base has never moved", () => {
    expect(reviewersAtHead([review(CODEX, HEAD)], HEAD, undefined)).toEqual([
      CODEX,
    ]);
  });

  /**
   * A review whose timestamp is missing cannot be SHOWN to postdate the
   * retarget, and unknown is not the same as covered — so it is withheld
   * rather than counted.
   */
  it("withholds coverage from a review with no submitted time once a bound exists", () => {
    expect(
      reviewersAtHead([review(CODEX, HEAD)], HEAD, "2026-08-14T10:00:00Z")
    ).toEqual([]);
  });

  it("answers empty rather than throwing when the query returned nothing usable", () => {
    expect(reviewersAtHead(undefined, HEAD)).toEqual([]);
    expect(reviewersAtHead([review(CODEX, HEAD)], "")).toEqual([]);
  });
});

describe("changesRequested", () => {
  const at = (state, submitted_at, id = 1) => ({
    id,
    user: { login: CODEX },
    commit_id: HEAD,
    state,
    submitted_at,
  });

  /**
   * A `CHANGES_REQUESTED` review states its case in the body and need not open
   * a thread, so thread resolution cannot observe it. Without a separate check
   * an explicit refusal reads as coverage with nothing outstanding.
   */
  it("blocks a head whose review requests changes, with no threads open", () => {
    const r = report({
      ...BASE,
      reviews: [at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z")],
      threads: [],
    });
    expect(r.unresolved_threads).toBe(0);
    expect(r.missing_reviews).not.toContain(CODEX);
    expect(r.verdict).toBe("CHANGES REQUESTED");
    expect(r.exitCode).toBe(EXIT_NOT_CLEAN);
  });

  /**
   * A COMMENTED review publishes feedback without withdrawing an objection, so
   * the request for changes survives it. Only the account that made the request
   * can retire it, by approving or having the review dismissed.
   */
  it("does not clear when the later review only comments", () => {
    const reviews = [
      at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1),
      at("COMMENTED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, ORDER)).toEqual([CODEX]);
    expect(report({ ...BASE, reviews, threads: [] }).verdict).toBe(
      "CHANGES REQUESTED"
    );
  });

  it("clears on a later approval", () => {
    const reviews = [
      at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1),
      at("APPROVED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, ORDER)).toEqual([]);
    expect(report({ ...BASE, reviews, threads: [] }).verdict).toBe("CLEAN");
  });

  /**
   * Dismissal and coverage are separate questions about the same review
   * object: a dismissed row grants no coverage, and it clears nothing either.
   */
  /**
   * Dismissal invalidates the review it names. A dismissed APPROVAL therefore
   * withdraws the clearance, leaving the objection standing — and a dismissed
   * changes-request is already represented by its own row no longer reading
   * `CHANGES_REQUESTED`, so no case needs `DISMISSED` to clear anything.
   */
  it("does not let a dismissed approval clear an objection", () => {
    const reviews = [
      at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1),
      at("DISMISSED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, ORDER)).toEqual([CODEX]);
    expect(reviewersAtHead(reviews, HEAD)).toEqual([CODEX]);
  });

  /**
   * The control for the case above: an EARLIER review must not clear a later
   * objection, which a rule reading whichever element came last in the array
   * would allow.
   */
  it("still blocks when the later review is the one requesting changes", () => {
    const reviews = [
      at("COMMENTED", "2026-08-14T10:00:00Z", 1),
      at("CHANGES_REQUESTED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, ORDER)).toEqual([CODEX]);
  });

  /**
   * The case a head-scoped rule gets wrong: an objection raised on an earlier
   * commit is not answered by pushing a new one, nor by a later remark on the
   * new head. Coverage is still required AT the head, so the two questions are
   * asked at different scopes from the same rows.
   */
  it("keeps an objection raised on an earlier commit alive at the head", () => {
    const reviews = [
      { ...at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1), commit_id: OLD },
      at("COMMENTED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, ORDER)).toEqual([CODEX]);
    expect(reviewersAtHead(reviews, HEAD)).toEqual([CODEX]);
    expect(report({ ...BASE, reviews, threads: [] }).verdict).toBe(
      "CHANGES REQUESTED"
    );
  });

  /** An approval AT THE HEAD answers an objection raised on an older commit. */
  it("clears when a later approval lands on the head", () => {
    const reviews = [
      { ...at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1), commit_id: OLD },
      at("APPROVED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, ORDER)).toEqual([]);
    expect(report({ ...BASE, reviews, threads: [] }).verdict).toBe("CLEAN");
  });

  /**
   * Reviews arrive out of order. An approval submitted LATER but pinned to an
   * OLDER commit says nothing about the revision being merged, so it must not
   * retire an objection raised against the head — which a timestamp-only rule
   * would let it do.
   */
  it("does not let a stale approval clear an objection against the head", () => {
    const reviews = [
      at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1),
      { ...at("APPROVED", "2026-08-14T11:00:00Z", 2), commit_id: OLD },
    ];
    expect(changesRequested(reviews, ORDER)).toEqual([CODEX]);
    expect(report({ ...BASE, reviews, threads: [] }).verdict).toBe(
      "CHANGES REQUESTED"
    );
  });

  /**
   * Three revisions: objected on A, approved on B, head moves to C. The
   * clearance was a fact about A and B and must survive the head advancing —
   * a rule comparing the approval against the CURRENT head resurrects an
   * objection every time someone pushes.
   */
  it("keeps a clearance made on an intermediate revision", () => {
    const A = OLD;
    const B = "cccccccccccccccccccccccccccccccccccccccc";
    const C = HEAD;
    const order = new Map([
      [A, 0],
      [B, 1],
      [C, 2],
    ]);
    const reviews = [
      { ...at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1), commit_id: A },
      { ...at("APPROVED", "2026-08-14T11:00:00Z", 2), commit_id: B },
      { ...at("COMMENTED", "2026-08-14T12:00:00Z", 3), commit_id: C },
    ];
    expect(changesRequested(reviews, order)).toEqual([]);
  });

  /** An approval on the very revision objected to clears it, head or not. */
  it("clears when the approval names the objected revision", () => {
    const reviews = [
      { ...at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1), commit_id: OLD },
      { ...at("APPROVED", "2026-08-14T11:00:00Z", 2), commit_id: OLD },
    ];
    expect(changesRequested(reviews, ORDER)).toEqual([]);
  });

  /**
   * The mirror of the case below, and it fails in the opposite direction.
   * A reviewer approves the HEAD, then a delayed `CHANGES_REQUESTED` pinned to
   * an EARLIER revision arrives afterwards. Timestamp order processes the
   * approval first, so a rule that only clears what is already on record
   * records the stale objection and reports the account as blocking a revision
   * it signed off.
   */
  it("does not record an objection an earlier-seen approval already covers", () => {
    const reviews = [
      at("APPROVED", "2026-08-14T10:00:00Z", 1),
      { ...at("CHANGES_REQUESTED", "2026-08-14T11:00:00Z", 2), commit_id: OLD },
    ];
    expect(changesRequested(reviews, ORDER, true)).toEqual([]);
    expect(report({ ...BASE, reviews, threads: [] }).verdict).toBe("CLEAN");
  });

  /**
   * The SAME-revision control the previous pair was missing, and the case that
   * makes the two directions asymmetric. A reviewer approves the head, then
   * submits `CHANGES_REQUESTED` on that same unchanged head: the objection is
   * their newer position and must stand. Treating equality as coverage here
   * reports a blocking reviewer as clean, and the objection itself supplies the
   * head coverage that lets the verdict reach CLEAN.
   */
  it("keeps an objection submitted after an approval on the same revision", () => {
    const reviews = [
      at("APPROVED", "2026-08-14T10:00:00Z", 1),
      at("CHANGES_REQUESTED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, ORDER, true)).toEqual([CODEX]);
    expect(report({ ...BASE, reviews, threads: [] }).verdict).toBe(
      "CHANGES REQUESTED"
    );
  });

  /**
   * Its counterpart, which must NOT regress: an approval arriving after an
   * objection on the same revision still clears it. Equality answers in this
   * direction because the approval is the later word.
   */
  it("clears an objection when the approval on that revision came after", () => {
    const reviews = [
      at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1),
      at("APPROVED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, ORDER, true)).toEqual([]);
  });

  /**
   * The control: an objection naming a revision the approval does NOT cover
   * still stands. Without it, "an approval was seen" would swallow every later
   * objection regardless of which revision each named.
   */
  it("still records an objection on a revision later than the approval", () => {
    const reviews = [
      { ...at("APPROVED", "2026-08-14T10:00:00Z", 1), commit_id: OLD },
      at("CHANGES_REQUESTED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, ORDER, true)).toEqual([CODEX]);
  });

  /**
   * Two objections from one account, the second naming an EARLIER revision
   * because reviews arrive out of order. An approval of that earlier revision
   * answers only what it named: retaining a single objection per account lets
   * the delayed one displace the first, and the approval then clears an
   * account whose position on the revision being merged is still that changes
   * are required.
   */
  it("keeps an objection against the head when a later one names an older revision", () => {
    const reviews = [
      at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1),
      { ...at("CHANGES_REQUESTED", "2026-08-14T11:00:00Z", 2), commit_id: OLD },
      { ...at("APPROVED", "2026-08-14T12:00:00Z", 3), commit_id: OLD },
    ];
    expect(changesRequested(reviews, ORDER)).toEqual([CODEX]);
    expect(report({ ...BASE, reviews, threads: [] }).verdict).toBe(
      "CHANGES REQUESTED"
    );
  });

  /**
   * A force-push or rebase replaces the objected revision, and the pull
   * request's commit list then describes only the current history — so the
   * objection names a commit the order no longer contains. An approval on
   * live history supersedes it; refusing to clear leaves an objection
   * standing that nothing can ever answer.
   */
  it("clears when the objected revision is no longer in the pull request", () => {
    const reviews = [
      {
        ...at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1),
        commit_id: ERASED,
      },
      at("APPROVED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, ORDER, true)).toEqual([]);
  });

  /**
   * The same reviews, with the order known to be INCOMPLETE. GitHub serves at
   * most 250 commits for one pull request, so a long history yields a map
   * missing revisions nobody rewrote — and a truncated order is
   * indistinguishable from a rebased one by inspection. Absence may only be
   * read as erasure once the order is known to be whole.
   */
  it("does not read absence as erasure when the commit order is truncated", () => {
    const reviews = [
      {
        ...at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1),
        commit_id: ERASED,
      },
      at("APPROVED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, ORDER, false)).toEqual([CODEX]);
    // Omitted entirely, which is the case a caller reaches by forgetting the
    // flag rather than by deciding anything. It must land on the refusing side.
    expect(changesRequested(reviews, ORDER)).toEqual([CODEX]);
    expect(report({ ...BASE, reviews, threads: [] }).verdict).toBe(
      "CHANGES REQUESTED"
    );
  });

  /**
   * A commit COUNT cannot establish that an order describes the revisions
   * being merged. A branch force-pushed to a different history of the same
   * length and restored before the later ref reads yields a map that satisfies
   * every size comparison while omitting the head — so `report` re-establishes
   * completeness from the head's presence rather than trusting the flag, and an
   * order that does not reach the revision under judgement licenses nothing.
   */
  it("does not read absence as erasure when the order omits the head", () => {
    const reviews = [
      {
        ...at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1),
        commit_id: ERASED,
      },
      { ...at("APPROVED", "2026-08-14T11:00:00Z", 2), commit_id: OLD },
      // Coverage at the head, so the verdict reaches the objection rather than
      // stopping at MISSING REVIEW AT HEAD. A COMMENTED review grants coverage
      // and clears nothing.
      at("COMMENTED", "2026-08-14T12:00:00Z", 3),
    ];
    // Marked complete, and genuinely missing HEAD — the transient history.
    const withoutHead = new Map([[OLD, 0]]);
    expect(
      report({
        ...BASE,
        reviews,
        threads: [],
        revisionOrder: withoutHead,
        revisionOrderComplete: true,
      }).verdict
    ).toBe("CHANGES REQUESTED");
    // The positive control: the same reviews and the same claim of
    // completeness, against an order that DOES reach the head, must clear.
    expect(
      report({
        ...BASE,
        reviews,
        threads: [],
        revisionOrder: new Map([
          [OLD, 0],
          [HEAD, 1],
        ]),
        revisionOrderComplete: true,
      }).verdict
    ).toBe("CLEAN");
  });

  /**
   * Presence is not enough: the head must be the FINAL revision. A branch that
   * fast-forwards to an already-reviewed child during the commit request and
   * returns before every ref recheck yields an order that CONTAINS the head and
   * continues past it, and a delayed approval pinned to that child would then
   * clear an objection at the head while the child is not what merges.
   */
  it("does not read absence as erasure when the order continues past the head", () => {
    const CHILD = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const reviews = [
      {
        ...at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1),
        commit_id: ERASED,
      },
      { ...at("APPROVED", "2026-08-14T11:00:00Z", 2), commit_id: CHILD },
      at("COMMENTED", "2026-08-14T12:00:00Z", 3),
    ];
    // HEAD is present, and the order does not end there.
    const pastHead = new Map([
      [OLD, 0],
      [HEAD, 1],
      [CHILD, 2],
    ]);
    expect(
      report({
        ...BASE,
        reviews,
        threads: [],
        revisionOrder: pastHead,
        revisionOrderComplete: true,
      }).verdict
    ).toBe("CHANGES REQUESTED");
  });

  /**
   * The control for the case above, in the opposite direction. An approval
   * naming a revision the pull request no longer has speaks to code that will
   * not merge, so it cannot answer an objection against live history — and
   * without this, "absent from the order" would clear in both directions.
   */
  it("does not clear when the approval names a revision the pull request no longer has", () => {
    const reviews = [
      at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1),
      { ...at("APPROVED", "2026-08-14T11:00:00Z", 2), commit_id: ERASED },
    ];
    expect(changesRequested(reviews, ORDER)).toEqual([CODEX]);
  });

  /**
   * An empty order is a commit list nobody read, not a pull request whose
   * revisions are all gone. Every revision reads as absent there, so a rule
   * clearing on absence alone would turn a failed query into a blanket
   * clearance — the reassuring direction.
   */
  it("does not clear from an unavailable commit order", () => {
    const reviews = [
      { ...at("CHANGES_REQUESTED", "2026-08-14T10:00:00Z", 1), commit_id: OLD },
      at("APPROVED", "2026-08-14T11:00:00Z", 2),
    ];
    expect(changesRequested(reviews, new Map())).toEqual([CODEX]);
    expect(changesRequested(reviews, undefined)).toEqual([CODEX]);
  });
});

describe("review states that are not an opinion", () => {
  const withState = state => [{ ...review(CODEX, HEAD), state }];

  it("does not count a DISMISSED review as coverage", () => {
    expect(reviewersAtHead(withState("DISMISSED"), HEAD)).toEqual([]);
  });

  /**
   * Coverage is granted from a known set rather than withheld from a known set,
   * so a state this code has not seen refuses rather than counts.
   */
  it("does not count an unrecognised state as coverage", () => {
    expect(reviewersAtHead(withState("SOMETHING_NEW"), HEAD)).toEqual([]);
    expect(reviewersAtHead(withState(undefined), HEAD)).toEqual([]);
  });

  it("counts APPROVED and COMMENTED", () => {
    expect(reviewersAtHead(withState("APPROVED"), HEAD)).toEqual([CODEX]);
    expect(reviewersAtHead(withState("COMMENTED"), HEAD)).toEqual([CODEX]);
  });
});

describe("unresolvedThreads", () => {
  it("counts only threads that are still open", () => {
    const threads = [
      { isResolved: false },
      { isResolved: true },
      { isResolved: false },
    ];
    expect(unresolvedThreads(threads)).toBe(2);
  });

  it("is zero when every thread is resolved", () => {
    expect(unresolvedThreads([{ isResolved: true }])).toBe(0);
  });

  /**
   * A thread whose state is absent is not evidence that it is resolved, so it
   * counts as open. A partial response must not be able to clear the gate while
   * reading as covered.
   */
  it("counts a thread whose state is missing as open", () => {
    expect(unresolvedThreads([{}])).toBe(1);
    expect(unresolvedThreads([{ isResolved: false }, {}])).toBe(2);
    expect(unresolvedThreads([{ isResolved: true }, {}])).toBe(1);
  });

  /**
   * A thread list that never arrived is not an empty one. Returning zero would
   * report "nothing outstanding" for a query that failed.
   */
  it("refuses to answer zero when the thread list is unavailable", () => {
    expect(unresolvedThreads(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(report({ ...BASE, threads: undefined }).verdict).toBe(
      "UNRESOLVED THREADS"
    );
    expect(report({ ...BASE, threads: undefined }).unresolved_threads).toBe(
      "unavailable"
    );
  });
});

describe("advisoryExemptions", () => {
  /**
   * A login named in both policies is required for coverage AND excluded from
   * blocking, so an unreduced advisory list would exempt a reviewer that is
   * simultaneously being asked to review. Blocking wins, and both gates read
   * this one rule — a gate filtering differently clears what the other holds.
   */
  it("removes a login that is also blocking", () => {
    expect(advisoryExemptions([CODEX], [RABBIT, CODEX])).toEqual([RABBIT]);
    expect(advisoryExemptions([CODEX], [CODEX])).toEqual([]);
  });

  /** The control: with no overlap the advisory list is returned intact. */
  it("leaves a purely advisory login alone", () => {
    expect(advisoryExemptions([CODEX], [RABBIT])).toEqual([RABBIT]);
  });

  /**
   * An unreadable policy exempts nothing, which counts every thread. A gate
   * that cannot read its policy must not hand out exemptions it cannot
   * justify, and returning the input unfiltered would do exactly that.
   */
  it("exempts nothing when either list is unreadable", () => {
    expect(advisoryExemptions(undefined, [RABBIT])).toEqual([RABBIT]);
    expect(advisoryExemptions([CODEX], undefined)).toEqual([]);
    expect(advisoryExemptions(undefined, undefined)).toEqual([]);
  });
});

describe("advisory review threads", () => {
  const thread = (login, isResolved) => ({
    isResolved,
    comments: { nodes: [{ author: { login } }] },
  });

  /**
   * A reviewer excluded from `blocking` must not hold the merge through a
   * thread either. Blocking on its threads would reinstate through one door the
   * policy that was closed at another.
   */
  it("does not count a thread opened by an advisory reviewer", () => {
    expect(unresolvedThreads([thread(RABBIT, false)], [RABBIT])).toBe(0);
    expect(report({ ...BASE, threads: [thread(RABBIT, false)] }).verdict).toBe(
      "CLEAN"
    );
  });

  /** The control: a blocking reviewer's thread still holds it. */
  it("counts a thread opened by a blocking reviewer", () => {
    expect(unresolvedThreads([thread(CODEX, false)], [RABBIT])).toBe(1);
    expect(report({ ...BASE, threads: [thread(CODEX, false)] }).verdict).toBe(
      "UNRESOLVED THREADS"
    );
  });

  /**
   * A human's thread blocks. Advisory is a named exemption, not a default, so
   * an author absent from that list counts.
   */
  it("counts a thread whose author is neither bot", () => {
    expect(unresolvedThreads([thread("a-reviewer", false)], [RABBIT])).toBe(1);
  });

  /**
   * An author the response did not carry counts. "I could not tell whose it
   * is" is not "it is safe to ignore".
   */
  it("counts a thread whose author is unreadable", () => {
    expect(unresolvedThreads([{ isResolved: false }], [RABBIT])).toBe(1);
    expect(
      unresolvedThreads([{ isResolved: false, comments: {} }], [RABBIT])
    ).toBe(1);
  });
});

describe("canonicalActorLogin", () => {
  /**
   * The measured shape. GitHub spells one identity two ways, and this is the
   * pair, read from the same pull request in the same minute:
   *
   *   REST    pulls/1286/comments  .user.login  -> "coderabbitai[bot]"
   *   GraphQL reviewThreads author .login       -> "coderabbitai"
   *   GraphQL same node            .__typename  -> "Bot"
   *
   * Configuration is written in the REST spelling, because that is the one a
   * person sees on the pull request, so REST is the canonical form and this
   * reconciles GraphQL to it.
   */
  it("restores the suffix GraphQL omits, for a bot", () => {
    expect(
      canonicalActorLogin({ login: "coderabbitai", __typename: "Bot" })
    ).toBe(RABBIT);
    expect(
      canonicalActorLogin({
        login: "chatgpt-codex-connector",
        __typename: "Bot",
      })
    ).toBe(CODEX);
  });

  /**
   * The whole reason the suffix may be appended at all. `__typename` is
   * assigned by GitHub and no account can present it, so a USER that registers
   * the name `coderabbitai` keeps its bare login and cannot borrow the app's
   * identity. Appending on the strength of the NAME would hand any account
   * that can comment the advisory reviewer's exemption.
   */
  it("refuses to promote a user that merely shares the name", () => {
    expect(
      canonicalActorLogin({ login: "coderabbitai", __typename: "User" })
    ).toBe("coderabbitai");
    expect(
      canonicalActorLogin({ login: "coderabbitai", __typename: "Organization" })
    ).toBe("coderabbitai");
    // No `__typename` at all is not a bot either. A partial response must not
    // be able to manufacture an exemption.
    expect(canonicalActorLogin({ login: "coderabbitai" })).toBe("coderabbitai");
  });

  it("is idempotent, so a login already in REST shape is unchanged", () => {
    expect(canonicalActorLogin({ login: RABBIT, __typename: "Bot" })).toBe(
      RABBIT
    );
  });

  /**
   * A deleted account comes back as `author: null`. Undefined rather than a
   * string, so the caller decides — and every caller here counts what it
   * cannot identify.
   */
  it("reports no login where there is no author to read", () => {
    expect(canonicalActorLogin(null)).toBeUndefined();
    expect(canonicalActorLogin(undefined)).toBeUndefined();
    expect(canonicalActorLogin({})).toBeUndefined();
    expect(canonicalActorLogin({ login: "" })).toBeUndefined();
  });
});

describe("the stability stamp moves when the verdict would", () => {
  const thread = (login, typename) => ({
    isResolved: false,
    comments: { nodes: [{ author: { login, __typename: typename } }] },
  });

  /**
   * The stamp exists so the observation window can tell whether the evidence
   * moved underneath it. `unresolvedThreads` reads the CANONICAL login, and
   * `__typename` decides what a login canonicalises to — so a stamp over the
   * raw login alone holds still across two snapshots that stand for different
   * verdicts, and the window reports the first snapshot's answer after the
   * second would have counted the thread.
   */
  it("distinguishes snapshots whose account KIND changes the verdict", () => {
    const asUser = [thread("coderabbitai", "User")];
    const asBot = [thread("coderabbitai", "Bot")];
    // The premise: these two really do decide differently.
    expect(unresolvedThreads(asUser, [RABBIT])).toBe(1);
    expect(unresolvedThreads(asBot, [RABBIT])).toBe(0);
    // So their stamps must differ, or the window cannot see the change.
    expect(fingerprint([], asUser, [])).not.toBe(fingerprint([], asBot, []));
  });

  /**
   * The other half, and the reason the stamp records the DERIVED value rather
   * than the two raw fields. A kind changing between two non-bot values cannot
   * move the verdict, and a stamp that moved anyway would report evidence
   * changing where nothing a decision reads did — retrying a settled answer.
   */
  it("holds still where the account kind cannot change the verdict", () => {
    const asUser = [thread("coderabbitai", "User")];
    const asOrg = [thread("coderabbitai", "Organization")];
    expect(unresolvedThreads(asUser, [RABBIT])).toBe(
      unresolvedThreads(asOrg, [RABBIT])
    );
    expect(fingerprint([], asUser, [])).toBe(fingerprint([], asOrg, []));
  });

  /** The control: an unrelated field still moves the stamp. */
  it("still moves when resolution changes", () => {
    const open = [thread("someone", "User")];
    const closed = [{ ...open[0], isResolved: true }];
    expect(fingerprint([], open, [])).not.toBe(fingerprint([], closed, []));
  });
});

describe("the review-thread query asks for what the code reads", () => {
  /**
   * The one property no fixture can establish. Every test above builds its own
   * thread objects, so they supply `__typename` whether or not the request ever
   * asked GitHub for it — removing the field from the query leaves all of them
   * green while, in production, no thread canonicalises to a bot, nothing is
   * ever exempt, and every advisory thread blocks. That is the defect this
   * change fixes, reachable again by editing one line nothing else watches.
   *
   * Asserted against the exported string the request actually sends, not a copy
   * of it, so the test cannot drift from the query the way a duplicated literal
   * would.
   */
  it("selects every author field the canonicaliser reads", () => {
    // Present, and inside the author selection rather than merely somewhere in
    // the document — a `__typename` on any other node would satisfy a bare
    // substring check while telling the canonicaliser nothing.
    expect(REVIEW_THREADS_QUERY).toContain("author { login __typename }");
  });

  /**
   * The query and the fragment stay one decision.
   *
   * `verify-merge.mjs` builds its own query from this same fragment, and it
   * reaches it through the dynamic sibling loader — an edge no static analysis
   * follows. So nothing else connects the two gates' field selections, and if
   * this query stopped being built from the fragment they could drift apart
   * again while both files still read correctly on their own.
   */
  it("is built from the fragment the other gate also uses", () => {
    expect(REVIEW_THREAD_NODE_FIELDS).toContain("author { login __typename }");
    expect(REVIEW_THREADS_QUERY).toContain(REVIEW_THREAD_NODE_FIELDS);
  });

  it("still selects the fields the rest of the read depends on", () => {
    // The control. If the query were replaced wholesale with something that
    // happened to mention the author fields, these would catch it — and if this
    // assertion ever fails alongside the one above, the query was rewritten
    // rather than adjusted.
    expect(REVIEW_THREADS_QUERY).toContain("isResolved");
    expect(REVIEW_THREADS_QUERY).toContain("pageInfo { hasNextPage endCursor }");
    expect(REVIEW_THREADS_QUERY).toContain("reviewThreads(first:100");
  });
});

describe("advisory threads, in the shape GraphQL actually sends", () => {
  /**
   * Built from the MEASURED GraphQL payload rather than from the constants the
   * filter is configured with. The helper above this one takes a login and
   * hands it straight back inside a thread, so the two sides that DIVERGE in
   * production are one value in the test, and it passes under any suffix
   * convention at all. That is why the divergence survived: the oracle was a
   * second derivation of the same source.
   */
  const botThread = (slug, isResolved) => ({
    isResolved,
    comments: { nodes: [{ author: { login: slug, __typename: "Bot" } }] },
  });

  it("exempts the advisory bot when its login arrives without the suffix", () => {
    expect(unresolvedThreads([botThread("coderabbitai", false)], [RABBIT])).toBe(
      0
    );
  });

  /**
   * THE DISCRIMINATING CASE, and the reason both bots appear in one payload.
   *
   * A fixture carrying a single bot is satisfied by three different wrong
   * implementations: today's, which matches neither and counts both; one that
   * strips the suffix from the config and matches everything ending in the
   * name; and one keyed on `__typename === "Bot"`, which exempts EVERY bot and
   * so waves through the blocking reviewer this gate exists to enforce.
   * Exactly one survives asserting that these two threads come out different.
   */
  it("exempts the advisory bot and still counts the blocking one", () => {
    const threads = [
      botThread("coderabbitai", false),
      botThread("chatgpt-codex-connector", false),
    ];
    expect(unresolvedThreads(threads, [RABBIT])).toBe(1);
  });

  /** A human's thread blocks, and carries no suffix in either API. */
  it("counts a human thread, whose login is the same in both APIs", () => {
    const human = {
      isResolved: false,
      comments: {
        nodes: [{ author: { login: "mobeenabdullah", __typename: "User" } }],
      },
    };
    expect(unresolvedThreads([human], [RABBIT])).toBe(1);
  });
});

describe("rateLimited", () => {
  it("names a reviewer whose comment carries the refusal marker", () => {
    const comments = [
      { user: { login: RABBIT }, body: "> Review limit reached\nwait" },
    ];
    expect(rateLimited(comments)).toEqual([RABBIT]);
  });

  /**
   * The marker is edited away in place once a review runs, so its absence is
   * not evidence of coverage. This pins that `rateLimited` answers only the
   * narrow question and never stands in for {@link missingReviewers}.
   */
  it("is empty once the marker has been edited away, even with no review at the head", () => {
    const comments = [
      { user: { login: RABBIT }, body: "Here is the review summary." },
    ];
    expect(rateLimited(comments)).toEqual([]);
    expect(missingReviewers([], comments, HEAD, [RABBIT])).toEqual([RABBIT]);
  });
});

describe("verdictFor", () => {
  it("is CLEAN and exits zero when every blocking reviewer saw the head and nothing is open", () => {
    expect(
      verdictFor({ missing: [], unresolved: 0, limited: [], blocking: [CODEX] })
    ).toEqual({
      verdict: "CLEAN",
      detail: null,
      exitCode: 0,
    });
  });

  it("refuses with a nonzero code when a blocking reviewer has not seen the head", () => {
    const v = verdictFor({ missing: [CODEX], blocking: [CODEX] });
    expect(v.verdict).toBe("MISSING REVIEW AT HEAD");
    expect(v.exitCode).toBe(EXIT_NOT_CLEAN);
  });

  it("refuses while any thread is open", () => {
    const v = verdictFor({ unresolved: 1, blocking: [CODEX] });
    expect(v.verdict).toBe("UNRESOLVED THREADS");
    expect(v.exitCode).toBe(EXIT_NOT_CLEAN);
  });

  /**
   * Composed through `report` rather than by handing `verdictFor` a limited
   * reviewer that is not also missing. A reviewer that refused for quota
   * reviewed nothing, so `report` always reports it as both — and only the
   * composed path can show which cause the verdict names.
   */
  it("names rate limiting rather than absence when a blocking reviewer refused", () => {
    const r = report({
      head: HEAD,
      reviews: [],
      threads: [],
      issueComments: [{ user: { login: CODEX }, body: "Review limit reached" }],
      blocking: [CODEX],
    });
    expect(r.missing_reviews).toContain(CODEX);
    expect(r.verdict).toBe("REVIEWER RATE LIMITED");
    expect(r.exitCode).toBe(EXIT_NOT_CLEAN);
  });

  /**
   * Missing coverage is reported ahead of open threads. Reporting the threads
   * first would send someone to resolve findings on a revision nobody read.
   */
  it("reports missing coverage ahead of open threads when both hold", () => {
    const v = verdictFor({
      missing: [CODEX],
      unresolved: 3,
      blocking: [CODEX],
    });
    expect(v.verdict).toBe("MISSING REVIEW AT HEAD");
  });

  it("lets an advisory reviewer be missing or rate limited without blocking", () => {
    const v = verdictFor({
      missing: [RABBIT],
      limited: [RABBIT],
      blocking: [CODEX],
    });
    expect(v.verdict).toBe("CLEAN");
    expect(v.exitCode).toBe(0);
  });

  /**
   * The control for the case above. An advisory reviewer must not become a way
   * to waive a blocking one, which a `blocking` list that was ignored entirely
   * would allow.
   */
  it("still blocks on the blocking reviewer while an advisory one is absent", () => {
    const v = verdictFor({ missing: [RABBIT, CODEX], blocking: [CODEX] });
    expect(v.verdict).toBe("MISSING REVIEW AT HEAD");
    expect(v.detail).toEqual([CODEX]);
  });
});

describe("a pull request that is no longer open", () => {
  /**
   * A merged pull request whose branch kept receiving pushes. Every other
   * answer here describes an OPEN pull request, so without this case the
   * verdict is "no review at the head" — true, useless, and repeated on every
   * run while commits absent from the merge sit on the branch.
   *
   * The verdict names them as CANDIDATES because absence from the merge is not
   * by itself loss: a branch reused for follow-up work collects such commits
   * legitimately, and only content against the squash separates the two.
   */

  it("names unmerged candidates rather than reporting missing coverage", () => {
    const v = verdictFor({
      missing: [CODEX],
      blocking: [CODEX],
      state: "MERGED",
      stranded: 4,
    });
    expect(v.verdict).toBe("MERGED WITH UNMERGED CANDIDATES");
    expect(v.detail).toEqual({ state: "MERGED", unmergedCandidates: 4 });
    expect(v.exitCode).toBe(EXIT_NOT_CLEAN);
  });

  /** A merged pull request whose branch did not move afterwards is done. */
  it("is satisfied by a merged pull request whose branch did not advance", () => {
    const v = verdictFor({ blocking: [CODEX], state: "MERGED", stranded: 0 });
    expect(v.verdict).toBe("ALREADY MERGED");
    expect(v.exitCode).toBe(0);
  });

  /**
   * Closed without merging is a refusal, not a completion. Sharing the merged
   * branch would report success for a pull request whose work never landed —
   * and a consumer reading the exit code would treat it as done.
   */
  it("refuses a closed pull request rather than calling it merged", () => {
    const v = verdictFor({ blocking: [CODEX], state: "CLOSED", stranded: 0 });
    expect(v.verdict).toBe("CLOSED WITHOUT MERGING");
    expect(v.exitCode).toBe(EXIT_NOT_CLEAN);
  });

  /**
   * The control. An OPEN pull request must still be judged on coverage and
   * threads, which a state check placed too early would skip.
   */
  it("still gates an open pull request", () => {
    const v = verdictFor({
      missing: [CODEX],
      blocking: [CODEX],
      state: "OPEN",
    });
    expect(v.verdict).toBe("MISSING REVIEW AT HEAD");
  });
});

describe("report", () => {
  const base = {
    head: HEAD,
    reviews: [review(CODEX, HEAD)],
    threads: [{ isResolved: true }],
    issueComments: [],
    blocking: [CODEX],
    advisory: [RABBIT],
  };

  it("is CLEAN when the blocking reviewer saw the head and nothing is open", () => {
    const r = report(base);
    expect(r.verdict).toBe("CLEAN");
    expect(r.exitCode).toBe(0);
  });

  /**
   * The advisory reviewer's gap is still REPORTED. A gate that silently drops
   * what it does not block on hides the coverage question rather than deciding
   * it.
   */
  it("reports an advisory reviewer's missing coverage without blocking on it", () => {
    const r = report(base);
    expect(r.missing_reviews).toContain(RABBIT);
    expect(r.verdict).toBe("CLEAN");
  });

  it("refuses when the blocking reviewer only reviewed an earlier commit", () => {
    const r = report({ ...base, reviews: [review(CODEX, OLD)] });
    expect(r.verdict).toBe("MISSING REVIEW AT HEAD");
    expect(r.exitCode).toBe(EXIT_NOT_CLEAN);
  });
});


/**
 * Where the queries are SENT.
 *
 * Every later request derives from this, so a wrong answer here describes one
 * repository while reading another — and the whole parsing was previously
 * reachable only by running the command.
 */
describe("resolveTarget", () => {
  it("defaults to the public host when nothing is configured", () => {
    expect(resolveTarget({})).toMatchObject({
      owner: "nextlyhq",
      name: "nextly",
      host: "github.com",
      repo: "nextlyhq/nextly",
      // Bare on github.com: host-qualifying it there is accepted but says
      // nothing, and the two forms should not both be in circulation.
      repoArg: "nextlyhq/nextly",
    });
  });

  it("reads the owner as the second-to-last segment", () => {
    // `gh` defines GH_REPO as `[HOST/]OWNER/REPO`, so taking the FIRST segment
    // as the owner is correct only for the two-segment form and silently wrong
    // for the Enterprise one.
    expect(resolveTarget({ GH_REPO: "ghe.example.com/acme/site" })).toMatchObject(
      {
        owner: "acme",
        name: "site",
        host: "ghe.example.com",
        repoArg: "ghe.example.com/acme/site",
      }
    );
  });

  it("takes the host from GH_HOST when GH_REPO carries none", () => {
    expect(
      resolveTarget({ GH_REPO: "acme/site", GH_HOST: "ghe.example.com" })
    ).toMatchObject({ host: "ghe.example.com" });
  });

  it("lets an explicit host in GH_REPO win over GH_HOST", () => {
    // Both are set and they disagree. Preferring GH_HOST would send the
    // requests somewhere other than the repository that was named.
    expect(
      resolveTarget({
        GH_REPO: "ghe.example.com/acme/site",
        GH_HOST: "other.example.com",
      })
    ).toMatchObject({ host: "ghe.example.com" });
  });

  it("refuses a value that is not [HOST/]OWNER/REPO", () => {
    expect(resolveTarget({ GH_REPO: "nextly" }).error).toMatch(/GH_REPO/);
    expect(resolveTarget({ GH_REPO: "a/b/c/d" }).error).toMatch(/GH_REPO/);
  });

  it("ignores empty segments from a trailing or doubled slash", () => {
    expect(resolveTarget({ GH_REPO: "acme/site/" })).toMatchObject({
      owner: "acme",
      name: "site",
      host: "github.com",
    });
  });
});

describe("resolveReviewers", () => {
  it("defaults to the configured blocking and advisory reviewers", () => {
    expect(resolveReviewers({})).toEqual({
      blocking: [CODEX],
      advisory: [RABBIT],
    });
  });

  it("trims a list written with spaces after the commas", () => {
    // An untrimmed entry matches no login, so the reviewer is silently dropped
    // and the gate reports clean without that reviewer's coverage.
    expect(
      resolveReviewers({ CI_VERDICT_BLOCKING: `${CODEX}, ${RABBIT}` })
    ).toMatchObject({ blocking: [CODEX, RABBIT] });
  });

  it("refuses when the blocking set is empty", () => {
    // Nobody blocking makes every verdict clean, which is far more likely to be
    // a mistyped variable than a decision — so it refuses rather than passing.
    expect(resolveReviewers({ CI_VERDICT_BLOCKING: " , " }).error).toMatch(
      /no blocking reviewer/
    );
  });

  it("accepts an empty advisory set", () => {
    // Advisory reviewers cannot hold a merge, so having none is a valid
    // configuration rather than the misconfiguration above.
    expect(resolveReviewers({ CI_VERDICT_ADVISORY: "" })).toEqual({
      blocking: [CODEX],
      advisory: [],
    });
  });
});
