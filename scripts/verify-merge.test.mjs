/**
 * Every case here is a defect this repository actually shipped, written as the
 * input that produced it.
 *
 * The procedure these functions replace lived as shell inside a Markdown rule.
 * It was wrong in several ways at once and each one was found by a reviewer
 * executing it mentally rather than by anything running it — so the tests are
 * organised by the WRONG ANSWER each function used to give, not by its
 * signature.
 */
import { describe, expect, it } from "vitest";

import {
  blockingJobs,
  checkability,
  countRewriteEvents,
  formatVerdict,
  gateVerdict,
  jobPasses,
  reviewCoverage,
  verdictCoversTip,
} from "./verify-merge.mjs";

const forcePush = { event: "head_ref_force_pushed" };
const commented = { event: "commented" };
const green = name => ({ name, status: "completed", conclusion: "success" });
const queued = name => ({ name, status: "queued", conclusion: null });

describe("countRewriteEvents", () => {
  it("counts events beyond the FIRST page", () => {
    // The original read one page. The timeline is paged at 100 and pull
    // requests here reach three pages, so a rewrite on page two counted as
    // zero — which is the answer that lets the check proceed.
    const pages = [[commented], [forcePush], [commented, forcePush]];

    expect(countRewriteEvents(pages)).toBe(2);
  });

  it("counts a deletion and a recreation, not only a force-push", () => {
    // Deleting a branch and recreating it at the merged head erases a tail
    // exactly as a force-push does, and the recreated ref reads as ordinary.
    const pages = [
      [{ event: "head_ref_deleted" }, { event: "head_ref_restored" }],
    ];

    expect(countRewriteEvents(pages)).toBe(2);
  });

  it("ignores unrelated timeline events", () => {
    // The control for the two above: if this returned non-zero, the cases
    // above would pass whether or not the event names were matched at all.
    expect(
      countRewriteEvents([
        [commented, { event: "labeled" }, { event: "merged" }],
      ])
    ).toBe(0);
  });

  it("refuses a non-array rather than treating it as empty", () => {
    expect(() => countRewriteEvents(undefined)).toThrow(TypeError);
  });
});

describe("checkability", () => {
  it("refuses when the ref does not resolve", () => {
    // Measured cause of a real false clean: a branch name typed from memory,
    // one word off the real head ref. The empty result was read as "the branch
    // was auto-deleted, nothing to check" on a pull request that HAD stranded a
    // commit.
    expect(checkability({ tip: "", rewriteEvents: 0 })).toEqual({
      checkable: false,
      reason: "no-ref",
    });
  });

  it("refuses when the rewrite count could not be read", () => {
    // The query that produces this count was piped into `awk`, and a pipeline
    // reports the LAST command's status — so an authentication error reached
    // `awk` as no input, which printed 0 and exited successfully.
    expect(checkability({ tip: "abc1234", rewriteEvents: null }).reason).toBe(
      "rewrite-count-unknown"
    );
  });

  it("refuses when history was rewritten", () => {
    expect(checkability({ tip: "abc1234", rewriteEvents: 1 }).reason).toBe(
      "history-rewritten"
    );
  });

  it("permits a present ref with no rewrites", () => {
    // The positive control. Without it every case above passes on a function
    // that refuses unconditionally.
    expect(checkability({ tip: "abc1234", rewriteEvents: 0 })).toEqual({
      checkable: true,
      reason: "ok",
    });
  });
});

describe("jobPasses", () => {
  it("does NOT pass a queued job", () => {
    // The defect this exists for. Filtering for `conclusion === "failure"` and
    // finding none reads as green; one merge commit here had four required
    // jobs queued for hours and answered zero failures the whole time.
    expect(jobPasses(queued("Lint / Typecheck / Test / Build"))).toBe(false);
  });

  it("does NOT pass a cancelled job", () => {
    // A concurrency group superseding a run reports `cancelled`, which is
    // indistinguishable from a failure to a gate that only looks for failures.
    expect(
      jobPasses({ name: "CI", status: "completed", conclusion: "cancelled" })
    ).toBe(false);
  });

  it("passes a job skipped by a condition", () => {
    // How this repository says "this commit cannot affect me". Branch
    // protection accepts it, so the gate must too.
    expect(
      jobPasses({
        name: "Browser tests",
        status: "completed",
        conclusion: "skipped",
      })
    ).toBe(true);
  });

  it("passes a successful job", () => {
    expect(jobPasses(green("CI"))).toBe(true);
  });
});

describe("blockingJobs", () => {
  it("names the jobs rather than counting them", () => {
    // A count sends the reader to the web UI. A name tells them whether the red
    // is theirs — which is what separates attributing a failure from
    // inheriting one, and four of tonight's reds were inherited.
    const runs = [green("gitleaks"), queued("Browser tests")];

    expect(blockingJobs(runs)).toEqual([
      { name: "Browser tests", status: "queued", conclusion: null },
    ]);
  });

  it("returns nothing when every job passes", () => {
    expect(blockingJobs([green("a"), green("b")])).toEqual([]);
  });
});

describe("verdictCoversTip", () => {
  it("rejects a verdict from an earlier revision", () => {
    // The incident behind all of this: a merge computed from a head that had
    // moved. A verdict describes the tree it read, and carried forward it is an
    // opinion about a revision nobody is merging.
    expect(
      verdictCoversTip("0dbcb9470", "ec025e8a80b262e426f780479d8346ac1a9788ae")
    ).toBe(false);
  });

  it("accepts a short sha that prefixes the tip", () => {
    expect(
      verdictCoversTip("91fd950028", "91fd9500285dcf264e3609a916b7518b591b51f3")
    ).toBe(true);
  });

  it("rejects a prefix too short to identify a commit", () => {
    // "a" prefixes an enormous number of commits. Accepting it would make the
    // comparison pass on almost anything.
    expect(verdictCoversTip("a", "abc1234def")).toBe(false);
  });

  it("rejects a missing verdict rather than treating absence as agreement", () => {
    expect(verdictCoversTip("", "abc1234def")).toBe(false);
    expect(verdictCoversTip(undefined, "abc1234def")).toBe(false);
  });
});

describe("reviewCoverage", () => {
  it("separates never-looked from looked-and-found-nothing", () => {
    // These render identically in every count-based gate. Two CI-wide changes
    // merged here with a reviewer that never ran, showing zero findings.
    expect(reviewCoverage(0)).toBe("not-reviewed");
    expect(reviewCoverage(3)).toBe("reviewed");
  });

  it("reports an unreadable count as unknown, not as reviewed", () => {
    expect(reviewCoverage(null)).toBe("unknown");
  });
});

describe("gateVerdict", () => {
  const passing = {
    tip: "91fd9500285dcf264e3609a916b7518b591b51f3",
    unresolvedThreads: 0,
    checkRuns: [green("CI"), green("gitleaks")],
    codexReviewedSha: "91fd950028",
    coderabbitReviewCount: 3,
  };

  it("passes a revision that meets every condition", () => {
    // The positive control for every case below. Without it they all pass on a
    // gate that blocks unconditionally.
    const verdict = gateVerdict(passing);

    expect(verdict.mergeable).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });

  it("blocks when jobs are merely QUEUED", () => {
    const verdict = gateVerdict({
      ...passing,
      checkRuns: [green("CI"), queued("Browser tests")],
    });

    expect(verdict.mergeable).toBe(false);
    expect(verdict.blockers.map(b => b.kind)).toContain("job-not-green");
  });

  it("blocks when NO jobs reported at all", () => {
    // Not a pass. It is the shape of a run that never started, and a pull
    // request merged here in exactly that state.
    const verdict = gateVerdict({ ...passing, checkRuns: [] });

    expect(verdict.blockers.map(b => b.kind)).toContain("no-checks");
  });

  it("blocks on an unreadable thread count rather than assuming zero", () => {
    const verdict = gateVerdict({ ...passing, unresolvedThreads: null });

    expect(verdict.blockers.map(b => b.kind)).toContain("threads-unknown");
  });

  it("blocks when the review verdict belongs to an earlier revision", () => {
    const verdict = gateVerdict({ ...passing, codexReviewedSha: "0dbcb9470" });

    expect(verdict.blockers.map(b => b.kind)).toContain("verdict-stale");
  });

  it("reports an unreviewed second reviewer WITHOUT blocking on it", () => {
    // The project runs with one reviewer deliberately. The requirement is that
    // its silence is never read as coverage, not that it gates.
    const verdict = gateVerdict({ ...passing, coderabbitReviewCount: 0 });

    expect(verdict.mergeable).toBe(true);
    expect(verdict.secondReviewer).toBe("not-reviewed");
  });

  it("reports EVERY blocker, not the first", () => {
    // One round of fixing should clear the gate rather than reveal the next
    // reason the merge was never going to happen.
    const verdict = gateVerdict({
      ...passing,
      unresolvedThreads: 2,
      checkRuns: [queued("CI")],
      codexReviewedSha: "0dbcb9470",
    });

    expect(verdict.blockers.map(b => b.kind).sort()).toEqual([
      "job-not-green",
      "unresolved-threads",
      "verdict-stale",
    ]);
  });
});

describe("formatVerdict", () => {
  it("says BLOCKED and names each reason", () => {
    const text = formatVerdict(
      gateVerdict({
        tip: "abc1234def",
        unresolvedThreads: 1,
        checkRuns: [green("CI")],
        codexReviewedSha: "abc1234def",
        coderabbitReviewCount: 1,
      })
    );

    expect(text).toContain("GATE BLOCKED");
    expect(text).toContain("unresolved-threads");
  });

  it("flags an unreviewed second reviewer on an otherwise passing gate", () => {
    const text = formatVerdict(
      gateVerdict({
        tip: "abc1234def",
        unresolvedThreads: 0,
        checkRuns: [green("CI")],
        codexReviewedSha: "abc1234def",
        coderabbitReviewCount: 0,
      })
    );

    expect(text).toContain("GATE PASSED");
    expect(text).toContain("not-reviewed");
  });
});
