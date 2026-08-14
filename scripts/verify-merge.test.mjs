/**
 * Every case here is a false clean this gate can produce, written as the input
 * that produces it.
 *
 * The cases are grouped by the WRONG ANSWER rather than by function signature,
 * because the answers are what overlap: several unrelated functions here fail
 * by reporting "nothing to see" for an input they could not read, and grouping
 * by that shape keeps the next instance next to its siblings instead of filed
 * under whichever function happened to grow it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INTEGRATION_PATHS_IGNORE,
  REQUIRED_CHECKS,
  blockingJobs,
  checkability,
  countRewriteEvents,
  exitCode,
  formatVerdict,
  gateVerdict,
  jobPasses,
  landedWhole,
  missingRequired,
  pathMatches,
  remoteForRepo,
  repoFromRemoteUrl,
  reviewCoverage,
  reviewsCoveringTip,
  runCli,
  statusAsRun,
  verdictCoversTip,
  workflowApplies,
} from "./verify-merge.mjs";

const forcePush = { event: "head_ref_force_pushed" };
const commented = { event: "commented" };
const green = name => ({ name, status: "completed", conclusion: "success" });
const queued = name => ({ name, status: "queued", conclusion: null });
/** The one check whose ABSENCE means no build ran. Fixtures must name it. */
const CI = "Lint / Typecheck / Test / Build";
/** A real 40-character object name; the gate refuses anything shorter as a tip. */
const FULL_TIP = "91fd9500285dcf264e3609a916b7518b591b51f3";
/** A change set every workflow in the repository runs for. */
const CODE_CHANGE = ["packages/nextly/src/index.ts"];
/** A change set `integration.yml` ignores at the trigger, so it never runs. */
const DOCS_CHANGE = ["docs/guide.md", "docs/api/reference.md"];
/** Every required check present and green, which is what a pass needs. */
const allGreen = () => [
  green(CI),
  green("gitleaks"),
  green("Integration (postgres)"),
  green("Integration (mysql)"),
  green("Integration (sqlite)"),
];

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

  it("refuses a page that is not an array, rather than counting it as zero", () => {
    // A failed or unparsed page arrives as `null` or an error object. The
    // outer check passes it, `flat()` carries it through, and optional access
    // ignores it — so a partly unread timeline would report no rewrites and
    // the branch as checkable.
    expect(() => countRewriteEvents([[commented], null])).toThrow(TypeError);
    expect(() =>
      countRewriteEvents([[commented], { message: "Bad credentials" }])
    ).toThrow(TypeError);
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

  it("passes a NEUTRAL job", () => {
    // GitHub accepts `neutral` for a required status check alongside `success`
    // and `skipped`. Refusing it would make this gate stricter than the
    // protection it models and block a revision the platform calls mergeable.
    expect(
      jobPasses({
        name: "advisory",
        status: "completed",
        conclusion: "neutral",
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

  it("rejects a verdict too short to identify a commit", () => {
    // "a" prefixes an enormous number of commits. Accepting it would make the
    // comparison pass on almost anything.
    expect(verdictCoversTip("a", FULL_TIP)).toBe(false);
  });

  it("rejects a TRUNCATED tip even when the verdict agrees with it", () => {
    // The comparison is asymmetric on purpose: the bot abbreviates, the ref
    // does not. Symmetric, this returns true — and the gate would then pass
    // without ever identifying the head revision it exists to pin.
    expect(verdictCoversTip(FULL_TIP, FULL_TIP.slice(0, 7))).toBe(false);
  });

  it("rejects a missing verdict rather than treating absence as agreement", () => {
    expect(verdictCoversTip("", FULL_TIP)).toBe(false);
    expect(verdictCoversTip(undefined, FULL_TIP)).toBe(false);
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
    tip: FULL_TIP,
    unresolvedThreads: 0,
    checkRuns: allGreen(),
    changedPaths: CODE_CHANGE,
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

  it("blocks on a NEGATIVE thread count, which is a sentinel and not a count", () => {
    // An I/O wrapper that reports -1 for "could not read" would otherwise pass
    // the integer check and add no blocker — unknown becoming zero by another
    // route, which the neighbouring validators already refuse.
    const verdict = gateVerdict({ ...passing, unresolvedThreads: -1 });

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
      checkRuns: allGreen().map(run => (run.name === CI ? queued(CI) : run)),
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
        tip: FULL_TIP,
        unresolvedThreads: 1,
        checkRuns: allGreen(),
        changedPaths: CODE_CHANGE,
        codexReviewedSha: FULL_TIP.slice(0, 10),
        coderabbitReviewCount: 1,
      })
    );

    expect(text).toContain("GATE BLOCKED");
    expect(text).toContain("unresolved-threads");
  });

  it("flags an unreviewed second reviewer on an otherwise passing gate", () => {
    const text = formatVerdict(
      gateVerdict({
        tip: FULL_TIP,
        unresolvedThreads: 0,
        checkRuns: allGreen(),
        changedPaths: CODE_CHANGE,
        codexReviewedSha: FULL_TIP.slice(0, 10),
        coderabbitReviewCount: 0,
      })
    );

    expect(text).toContain("GATE PASSED");
    expect(text).toContain("not-reviewed");
  });
});

describe("statusAsRun", () => {
  it("treats a pending status as NOT passing", () => {
    // The title check reports through the statuses API, not check-runs. A
    // gate that reads only check-runs calls the revision green while the
    // title check is still pending.
    expect(
      jobPasses(statusAsRun({ context: "PR title", state: "pending" }))
    ).toBe(false);
  });

  it("treats a failing status as NOT passing", () => {
    expect(
      jobPasses(statusAsRun({ context: "CodeRabbit", state: "failure" }))
    ).toBe(false);
  });

  it("treats a successful status as passing", () => {
    // The positive control: without it, both cases above pass on a normaliser
    // that refuses everything.
    expect(
      jobPasses(statusAsRun({ context: "CodeRabbit", state: "success" }))
    ).toBe(true);
  });
});

describe("missingRequired", () => {
  it("reports the CI job when only unrelated workflows reported", () => {
    // The workflows are independent, so a run where `ci.yml` never created
    // its jobs while `secret-scan.yml` succeeded yields a non-empty,
    // all-green set containing no build and no tests. Absence is invisible to
    // any filter over what is present.
    expect(missingRequired([green("gitleaks")], CODE_CHANGE)).toContain(
      "Lint / Typecheck / Test / Build"
    );
  });

  it("reports nothing when the required check reported, even failing", () => {
    // Presence, not success — `blockingJobs` judges the outcome. Conflating
    // them would report a failing required job twice and an absent one never.
    const runs = allGreen();
    runs[0] = queued("Lint / Typecheck / Test / Build");

    expect(missingRequired(runs, CODE_CHANGE)).toEqual([]);
  });

  it("reports the integration legs a code change was due to run", () => {
    // The unit suites mock the drivers and the browser tests run on sqlite
    // alone, so these are the only coverage a Postgres- or MySQL-specific
    // regression has. Listing the CI job and gitleaks while omitting them let a
    // run where `integration.yml` created no check-runs pass on the other two
    // being green.
    expect(
      missingRequired(
        [green("Lint / Typecheck / Test / Build"), green("gitleaks")],
        CODE_CHANGE
      )
    ).toEqual([
      "Integration (postgres)",
      "Integration (mysql)",
      "Integration (sqlite)",
    ]);
  });

  it("does NOT report the integration legs the workflow filtered out", () => {
    // The positive control for the case above. Without it, requiring the
    // integration checks unconditionally would block every documentation pull
    // request forever, and the test above would pass on that implementation.
    expect(
      missingRequired(
        [green("Lint / Typecheck / Test / Build"), green("gitleaks")],
        DOCS_CHANGE
      )
    ).toEqual([]);
  });

  it("requires every check when the change set could not be read", () => {
    // An unknown change set must not excuse a check. The failure this whole
    // file guards is a gate reporting clean because it could not see, so the
    // unreadable case resolves toward demanding evidence.
    expect(missingRequired([green("gitleaks")], undefined)).toEqual([
      "Lint / Typecheck / Test / Build",
      "Integration (postgres)",
      "Integration (mysql)",
      "Integration (sqlite)",
    ]);
  });

  it("names the checks whose ABSENCE means no coverage", () => {
    expect(REQUIRED_CHECKS.map(c => c.name)).toEqual([
      "Lint / Typecheck / Test / Build",
      "gitleaks",
      "Integration (postgres)",
      "Integration (mysql)",
      "Integration (sqlite)",
    ]);
  });
});

describe("pathMatches", () => {
  it("lets ** span directory separators and * stop at one", () => {
    expect(pathMatches("docs/**", "docs/api/reference.md")).toBe(true);
    expect(pathMatches("*.md", "docs/guide.md")).toBe(false);
  });

  it("does not treat a dot in the pattern as a wildcard", () => {
    // `.` unescaped matches any character, so `**/*.md` would accept
    // `srcXmd` — a filter admitting source files as documentation.
    expect(pathMatches("**/*.md", "packages/nextly/srcXmd")).toBe(false);
  });

  it("reads **/ as requiring a directory, which errs toward requiring", () => {
    // A root-level `README.md` does not match `**/*.md` on the literal reading
    // of the filter, so a pull request touching only that file is treated as
    // one `integration.yml` runs for. That direction is deliberate: over-
    // requiring a check produces an argument, under-requiring one produces a
    // silent gap, which is the failure this file exists to refuse.
    expect(pathMatches("**/*.md", "README.md")).toBe(false);
    expect(pathMatches("**/*.md", "docs/guide.md")).toBe(true);
  });
});

describe("workflowApplies", () => {
  it("runs the workflow when ONE file escapes the filter", () => {
    // GitHub skips only when every changed file matches, so a pull request
    // that edits documentation and one source file still runs it. Treating
    // "mostly documentation" as ignored is how a code change loses its
    // database coverage.
    expect(
      workflowApplies(INTEGRATION_PATHS_IGNORE, [
        "docs/guide.md",
        "packages/nextly/src/index.ts",
      ])
    ).toBe(true);
  });

  it("skips the workflow when every file matches", () => {
    expect(workflowApplies(INTEGRATION_PATHS_IGNORE, DOCS_CHANGE)).toBe(false);
  });

  it("applies when the change set is unknown or empty", () => {
    expect(workflowApplies(INTEGRATION_PATHS_IGNORE, undefined)).toBe(true);
    expect(workflowApplies(INTEGRATION_PATHS_IGNORE, [])).toBe(true);
  });

  it("applies when the workflow declares no filter at all", () => {
    expect(workflowApplies([], DOCS_CHANGE)).toBe(true);
  });
});

describe("reviewsCoveringTip", () => {
  const other = "0".repeat(40);
  const tip = "9".repeat(40);

  it("ignores a review written against an EARLIER revision", () => {
    // Counting it reports a reviewer as having covered a commit it never saw.
    const reviews = [
      { user: { login: "coderabbitai[bot]" }, commit_id: other },
    ];

    expect(reviewsCoveringTip(reviews, tip, "coderabbitai[bot]")).toEqual([]);
  });

  it("counts a review whose commit_id IS the tip", () => {
    const reviews = [{ user: { login: "coderabbitai[bot]" }, commit_id: tip }];

    expect(reviewsCoveringTip(reviews, tip, "coderabbitai[bot]")).toHaveLength(
      1
    );
  });

  it("ignores another reviewer's review of the same revision", () => {
    const reviews = [
      { user: { login: "chatgpt-codex-connector[bot]" }, commit_id: tip },
    ];

    expect(reviewsCoveringTip(reviews, tip, "coderabbitai[bot]")).toEqual([]);
  });

  it("refuses an abbreviated tip even when a record matches it exactly", () => {
    // Both sides abbreviated is the ONLY shape where the length guard decides
    // anything: against a full `commit_id` the comparison already fails, so a
    // test using one passes whether or not the guard exists — which is what
    // the first version of this test did. Coverage must be established against
    // a full object name; a match obtained by truncating both sides identifies
    // no particular commit.
    const short = tip.slice(0, 9);
    const reviews = [
      { user: { login: "coderabbitai[bot]" }, commit_id: short },
    ];

    expect(reviewsCoveringTip(reviews, short, "coderabbitai[bot]")).toEqual([]);
  });
});

describe("gateVerdict + required checks", () => {
  it("blocks when the required check never reported, though every run is green", () => {
    // The dangerous shape: nothing failed, nothing is pending, and the build
    // never ran.
    const verdict = gateVerdict({
      tip: "91fd9500285dcf264e3609a916b7518b591b51f3",
      unresolvedThreads: 0,
      checkRuns: [green("gitleaks")],
      codexReviewedSha: "91fd950028",
      coderabbitReviewCount: 1,
    });

    expect(verdict.mergeable).toBe(false);
    expect(verdict.blockers.map(b => b.kind)).toContain(
      "required-check-absent"
    );
  });
});

describe("landedWhole", () => {
  it("refuses to answer for a branch whose history was rewritten", () => {
    // An empty candidate list from an unanswerable branch is not evidence.
    // A force-push resetting a stranded commit away leaves the range empty and
    // indistinguishable from a branch that never had one.
    expect(
      landedWhole({
        checkable: false,
        reason: "history-rewritten",
        candidates: [],
      })
    ).toEqual({
      verdict: "not-checkable",
      reason: "history-rewritten",
      candidates: [],
    });
  });

  it("refuses for a ref that does not resolve, rather than reporting clean", () => {
    expect(
      landedWhole({ checkable: false, reason: "no-ref", candidates: [] })
        .verdict
    ).toBe("not-checkable");
  });

  it("reports CANDIDATES, never a loss", () => {
    // The range says only "absent from the merged head". A surviving branch
    // also collects force-pushes, rebases and follow-up work, so naming this
    // "lost" would raise a false alarm in a procedure whose whole value is
    // that its alarms mean something.
    const result = landedWhole({
      checkable: true,
      reason: "ok",
      candidates: [
        "f4d798078 test(blocks-react): pair the oversized array again",
      ],
    });

    expect(result.verdict).toBe("candidates");
    expect(result.candidates).toHaveLength(1);
  });

  it("distinguishes an empty answer from no answer", () => {
    // The positive control for the two refusals above: without it they pass on
    // a function that refuses unconditionally, and the whole point is that
    // "checked, found nothing" and "could not check" are different results.
    expect(
      landedWhole({ checkable: true, reason: "ok", candidates: [] }).verdict
    ).toBe("no-candidates");
  });

  it("refuses a non-array rather than treating it as empty", () => {
    expect(() =>
      landedWhole({ checkable: true, reason: "ok", candidates: null })
    ).toThrow(TypeError);
  });
});

describe("REQUIRED_CHECKS", () => {
  it("includes the secret scan, which is its own workflow", () => {
    // `secret-scan.yml` runs on every pull request and the repository calls it
    // the enforcement gate. With only the CI job listed, a run where that
    // workflow created no check-run passed on an unrelated workflow being
    // green — absence being invisible, one workflow along.
    expect(REQUIRED_CHECKS.map(c => c.name)).toContain("gitleaks");

    const withoutScan = allGreen().filter(run => run.name !== "gitleaks");
    expect(missingRequired(withoutScan, CODE_CHANGE)).toEqual(["gitleaks"]);
  });
});

describe("INTEGRATION_PATHS_IGNORE against the workflow it mirrors", () => {
  // The constant is a copy of a filter that lives in `integration.yml`, and two
  // spellings of one rule drift silently — the copy keeps looking correct while
  // the workflow moves underneath it, and the gate then excuses a check the
  // workflow was due to create.
  const workflow = readFileSync(
    fileURLToPath(new URL("../.github/workflows/integration.yml", import.meta.url)),
    "utf8"
  );

  /** The `paths-ignore` globs declared under one trigger in a workflow file. */
  const declaredIgnores = trigger => {
    const lines = workflow.split("\n");
    const start = lines.findIndex(l => l.trimEnd() === `  ${trigger}:`);
    if (start === -1) return [];
    const globs = [];
    let collecting = false;
    for (const line of lines.slice(start + 1)) {
      // Any line at the trigger's own indent or shallower ends the block, so a
      // filter belonging to the NEXT trigger is never read as this one's.
      if (/^ {0,2}\S/.test(line)) break;
      if (line.trim() === "paths-ignore:") {
        collecting = true;
        continue;
      }
      if (!collecting) continue;
      const entry = /^\s*-\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
      if (!entry) break;
      globs.push(entry[1]);
    }
    return globs;
  };

  it("finds a filter at all, so a failed parse cannot read as agreement", () => {
    // Without this, restructuring the workflow makes the extractor return
    // nothing, and an empty list compares equal to an empty list — the parse
    // failing would certify the mirror rather than fail the build.
    expect(declaredIgnores("pull_request").length).toBeGreaterThan(0);
  });

  it("matches what the workflow actually declares", () => {
    expect(declaredIgnores("pull_request")).toEqual([
      ...INTEGRATION_PATHS_IGNORE,
    ]);
  });
});

describe("repoFromRemoteUrl", () => {
  it("reduces every spelling of one repository to the same name", () => {
    // A string comparison against a single spelling misses the others and falls
    // through to a remote that may be a different repository entirely.
    for (const url of [
      "https://github.com/nextlyhq/nextly.git",
      "https://github.com/nextlyhq/nextly",
      "git@github.com:nextlyhq/nextly.git",
      "ssh://git@github.com/nextlyhq/nextly.git",
      "https://github.com/nextlyhq/nextly/",
    ]) {
      expect(repoFromRemoteUrl(url)).toBe("nextlyhq/nextly");
    }
  });

  it("does not read a DIFFERENT repository as the same one", () => {
    // The control that gives the case above meaning: without it, a function
    // returning a constant would satisfy every assertion there.
    expect(repoFromRemoteUrl("git@github.com:someone/nextly.git")).toBe(
      "someone/nextly"
    );
    expect(repoFromRemoteUrl("https://gitlab.com/nextlyhq/nextly.git")).toBe(
      null
    );
    expect(repoFromRemoteUrl("")).toBe(null);
  });
});

describe("remoteForRepo", () => {
  it("does NOT use origin when origin is a different repository", () => {
    // Running from a fork checkout, a pull request whose head lives upstream
    // would otherwise resolve against a same-named branch on the fork — a real,
    // unrelated revision whose checks and reviews the gate would then report as
    // this pull request's.
    const remotes = [
      ["origin", "git@github.com:contributor/nextly.git"],
      ["upstream", "https://github.com/nextlyhq/nextly.git"],
    ];

    expect(remoteForRepo("nextlyhq/nextly", remotes)).toBe("upstream");
  });

  it("prefers a local remote that IS the repository", () => {
    // So configured credentials and transports keep working in the ordinary
    // case rather than every invocation reaching for an anonymous URL.
    expect(
      remoteForRepo("nextlyhq/nextly", [
        ["origin", "git@github.com:nextlyhq/nextly.git"],
      ])
    ).toBe("origin");
  });

  it("falls back to the canonical URL when no remote matches", () => {
    expect(remoteForRepo("nextlyhq/nextly", [["origin", "/tmp/somewhere"]])).toBe(
      "https://github.com/nextlyhq/nextly.git"
    );
    expect(remoteForRepo("nextlyhq/nextly", [])).toBe(
      "https://github.com/nextlyhq/nextly.git"
    );
  });
});

describe("runCli", () => {
  it("reports a failure to LOOK as 2, not as a rejection", () => {
    // Helpers throw rather than degrading, which is right, but an uncaught
    // throw exits 1 — the code meaning the gate examined the revision and
    // rejected it. An expired token would be indistinguishable from a verdict
    // and a caller would stop rather than retry.
    expect(
      runCli(["798"], () => {
        throw new Error("gh: authentication failed");
      })
    ).toBe(2);
  });

  it("passes a real verdict through untouched", () => {
    // The control: without it, a wrapper returning 2 unconditionally passes.
    expect(runCli(["798"], () => 0)).toBe(0);
    expect(runCli(["798"], () => 1)).toBe(1);
  });
});

describe("exitCode", () => {
  it("refuses success while landed-whole candidates are unsettled", () => {
    // `landedWhole` names commits the merge does not contain and stops short of
    // calling them lost, because the verdict comes from confirming each by
    // content. Printing that list while exiting 0 lets automation read a
    // possibly-lost tail as verified — the candidates were computed and never
    // reached the decision.
    expect(exitCode({ landedVerdict: "candidates", mergeable: true })).toBe(2);
  });

  it("does not let an open branch's rewritten history mask its verdict", () => {
    // Before a merge there is nothing to have landed, so reachability answers a
    // question that has not been asked. Taking it directly made every open pull
    // request with a force-push in its history exit 2 — reporting "could not
    // answer" over a gate that had answered, in both directions.
    expect(exitCode({ landedVerdict: "n/a", mergeable: false })).toBe(1);
    expect(exitCode({ landedVerdict: "n/a", mergeable: true })).toBe(0);
  });

  it("passes when the branch had nothing the merge did not take", () => {
    // The positive control for the case above: without it, an implementation
    // that never returns 0 satisfies it.
    expect(
      exitCode({ landedVerdict: "no-candidates", mergeable: true })
    ).toBe(0);
  });

  it("reports an unanswerable branch as unsettled, not as blocked", () => {
    // 2 rather than 1, so a caller can tell "the gate says no" from "the gate
    // did not get to answer" and escalate the second rather than retrying it.
    expect(
      exitCode({ landedVerdict: "not-checkable", mergeable: true })
    ).toBe(2);
  });

  it("blocks on the ordinary gate when everything else is settled", () => {
    expect(
      exitCode({ landedVerdict: "no-candidates", mergeable: false })
    ).toBe(1);
  });
});
