import { describe, expect, it } from "vitest";

import {
  missingReviewers,
  rateLimited,
  report,
  reviewersAtHead,
  unresolvedThreads,
  verdictFor,
} from "./ci-verdict.mjs";

const CODEX = "chatgpt-codex-connector[bot]";
const RABBIT = "coderabbitai[bot]";
const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const review = (login, commit_id, id = 1) => ({
  id,
  user: { login },
  commit_id,
});

/** A pull request that is otherwise clean, so one varied field decides. */
const BASE = {
  head: HEAD,
  reviews: [review(CODEX, HEAD)],
  threads: [],
  issueComments: [],
  blocking: [CODEX],
  advisory: [RABBIT],
};

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
      missingReviewers([review("codex-impersonator", HEAD)], HEAD, [CODEX])
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

  it("answers empty rather than throwing when the query returned nothing usable", () => {
    expect(reviewersAtHead(undefined, HEAD)).toEqual([]);
    expect(reviewersAtHead([review(CODEX, HEAD)], "")).toEqual([]);
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
   * counts as open. The earlier version of this case asserted the opposite of
   * what its own comment claimed to guard, which is the shape that lets a
   * partial response clear a gate while reading as covered.
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
    expect(missingReviewers([], HEAD, [RABBIT])).toEqual([RABBIT]);
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
    expect(v.exitCode).toBe(1);
  });

  it("refuses while any thread is open", () => {
    const v = verdictFor({ unresolved: 1, blocking: [CODEX] });
    expect(v.verdict).toBe("UNRESOLVED THREADS");
    expect(v.exitCode).toBe(1);
  });

  /**
   * Reported through `report`, not by handing `verdictFor` a limited reviewer
   * that is somehow not also missing. A reviewer that refused for quota
   * reviewed nothing, so it is ALWAYS missing too — and an earlier ordering put
   * absence first, which made this verdict unreachable for the only state that
   * produces it while a unit test kept it green on an impossible input.
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
    expect(r.exitCode).toBe(1);
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
    expect(r.exitCode).toBe(1);
  });
});
