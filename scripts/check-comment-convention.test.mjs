import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ALLOWLIST_FILE,
  DEFAULT_ROOTS,
  EXCLUDED_FILES,
  FORBIDDEN,
  commentText,
  isReviewDomain,
  offencesIn,
  digestOffences,
  readAllowlist,
  SOURCE_EXTENSIONS,
  sourceFiles,
} from "./check-comment-convention.mjs";

/**
 * Controls on the checker itself.
 *
 * The scan reports "no offences" both when the repository is clean and when the patterns match
 * nothing they should, and those two states are indistinguishable from the exit code. So the
 * patterns are exercised against text where the answer is known, in both directions.
 *
 * The negative controls carry more weight than the positive ones. A pattern that fires on
 * ordinary prose gets silenced, and a silenced check is worth less than no check — so each of
 * these is a sentence that a correct comment could contain.
 */
describe("the forbidden patterns", () => {
  it.each([
    "// this took four review rounds to find",
    "/* Codex flagged this */",
    "// the reviewer asked for a guard here",
    "// added in this PR",
    "// left over from the pull request that split the module",
    "// after two rounds of review we settled on the second form",
  ])("rejects %j", text => {
    expect(offencesIn(text).length).toBeGreaterThan(0);
  });

  it.each([
    // Ordinary technical prose that an over-broad pattern would reject. Each of these describes
    // runtime behaviour using vocabulary the process-narration patterns brush against.
    "// the second time the callback runs, reuse the cached value",
    "// the first occurrence sees the `+` that leaves the first root",
    "// a round trip out of the browser costs more than the assertion",
    "// of whether we found a user, which the lookup reports either way",
    "// rounds the measurement down so a sub-pixel shift still reads as movement",
    "// reviewer permissions are a role, not a person",
    // Ordinal wording paired with technical discovery verbs. Each of these describes runtime
    // behaviour, and a matcher keyed on that pairing rejects all of them — which is why ordinal
    // process narration is left unenforced rather than approximated.
    "// the third instance in the array owns the separator",
    "// the second attempt misses the cache and refetches",
    "// the first guard catches a null id before the query runs",
    "// we found no user, so the lookup returns null",
    "// a later round of retries reuses the same backoff",
  ])("accepts %j", text => {
    expect(offencesIn(text)).toEqual([]);
  });

  it("reports WHY, not just that something matched", () => {
    const [offence] = offencesIn("// Codex flagged this");
    // The message is what a developer acts on. "Something is wrong here" sends them to read the
    // pattern list; naming the shape tells them what to rewrite.
    expect(offence?.why).toBe("names a review tool");
  });

  // A control on the control: the list must be non-empty, or every assertion above holds
  // vacuously and the checker passes everything.
  it("has patterns to apply", () => {
    expect(FORBIDDEN.length).toBeGreaterThan(0);
  });
});

describe("the comment extractor", () => {
  it("reads comments and not the code around them", () => {
    const source = [
      'const message = "see the pull request for details";',
      "// this PR changes the default",
    ].join("\n");

    // The string literal must NOT be reported: scanning whole lines would make the check report
    // on data — an error message, a test fixture — rather than on prose.
    const found = commentText(source);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("this PR changes the default");
  });

  it("reads block comments whole", () => {
    const found = commentText("/**\n * Codex asked for this.\n */\nconst x = 1;");
    expect(found.join("")).toContain("Codex asked for this.");
  });

  it("does not read comment syntax inside a string literal", () => {
    // A fixture holding comment syntax is DATA. Reporting it makes the check comment on the
    // contents of tests rather than on prose, which is how a check like this becomes noise.
    expect(offencesIn('const fixture = "/* Codex flagged this */";')).toEqual([]);
    expect(offencesIn("const s = `see the pull request`;")).toEqual([]);
    // Control: the same text as an actual comment IS reported.
    expect(offencesIn("/* Codex flagged this */").length).toBeGreaterThan(0);
  });

  it("does not treat a URL as a comment", () => {
    // `https://example.com` contains `//`. Treating it as a comment would let a link's text
    // trigger the patterns, which is the commonest way a scan like this becomes noise.
    expect(commentText('const url = "https://example.com/pull-request";')).toEqual(
      []
    );
  });
});

describe("the file walk", () => {
  it("reads every extension it advertises", () => {
    // Per extension, not per directory. A count over a directory is satisfied by whichever
    // suffixes happen to dominate it, so dropping `.cjs` or `.jsx` from the list leaves any
    // threshold intact while tracked files of that type silently stop being checked.
    //
    // The expected count per suffix is asked of git rather than written down here, so this
    // compares the scanner against the repository instead of against a number that was true when
    // it was typed.
    //
    // `.cts` and `.jsx` currently match no tracked file. They stay on the list because they are
    // valid module suffixes and a future file carrying one should be read from the day it lands,
    // but their assertion below is vacuous and is not evidence of anything.
    const scanned = sourceFiles(".");
    for (const ext of SOURCE_EXTENSIONS) {
      const tracked = execFileSync("git", ["ls-files", "--", `*${ext}`], {
        encoding: "utf8",
      })
        .split("\n")
        .filter(path => path.endsWith(ext))
        // The checker and its test are excluded by name: both necessarily contain what they
        // forbid. Subtracting them here keeps the comparison against the repository honest
        // rather than loosening it to an inequality that would hide a real gap.
        .filter(path => !EXCLUDED_FILES.has(path));
      const seen = scanned.filter(path => path.endsWith(ext));
      expect(seen.length, `${ext}: scanner saw ${seen.length} of ${tracked.length}`).toBe(
        tracked.length
      );
    }
  });

  it("reaches every root the default scan names", () => {
    // Iterated FROM `DEFAULT_ROOTS` rather than from a list repeated here. A restated list
    // agrees on the day it is written and stops agreeing silently — dropping a root from the
    // code would leave this passing over the roots it still names.
    expect(DEFAULT_ROOTS.length).toBeGreaterThan(0);
    for (const root of DEFAULT_ROOTS) {
      expect(sourceFiles(root).length, `${root} contributed no files`).toBeGreaterThan(0);
    }
  });

  it("covers the directories that hold authored source", () => {
    // The membership assertion the loop above cannot make: it checks that each NAMED root is
    // real, not that the roots worth naming are named. `templates` ships to users and was
    // absent, so 121 files were unchecked while the scan reported clean.
    for (const required of ["packages", "apps", "e2e", "templates", "scripts"]) {
      expect(DEFAULT_ROOTS, `${required} is outside the enforced scope`).toContain(required);
    }
  });

  it("reads authored source and not build output", () => {
    // The list comes from git rather than from a directory walk. A walk reads whatever the
    // machine's build commands left behind, and generated bundles embed the comments of every
    // module they bundle — so the same sources scanned clean in a fresh worktree and reported
    // twenty findings against `.next-e2e/` paths in a checkout where that directory existed.
    const generated = sourceFiles("apps").filter(path => /\/\.next|\/dist\//.test(path));
    expect(generated, "generated output is not authored source").toEqual([]);
  });
});

/**
 * The allowlist is what lets this rule be enforced from its first commit: it records the comments
 * that predated the check, so the rule blocks new ones without demanding that whoever adds it
 * rewrite prose belonging to other authors.
 *
 * Its value depends entirely on only ever shrinking, and nothing about the JSON file itself says
 * so. These are what say so.
 */
describe("the allowlist", () => {
  // Pinned so growth appears in the diff. Without it an entry can be added in the same commit as
  // the comment it exempts, which turns the allowlist into a way of silencing the check rather
  // than a record of what predates it. Lower this as entries are removed; never raise it.
  const EXPECTED_ENTRIES = 243;
  const EXPECTED_TOTAL = 457;

  it("matches its pinned size exactly", () => {
    expect(readAllowlist().size).toBe(EXPECTED_ENTRIES);
  });

  it("matches its pinned TOTAL exactly", () => {
    // The size alone cannot see growth: adding an offence to a file already listed raises that
    // entry's count and leaves the number of entries untouched, so a shrink-only list grows
    // while every size assertion still passes. Lower both numbers as offences are fixed.
    const total = [...readAllowlist().values()].reduce((sum, e) => sum + e.count, 0);
    expect(total).toBe(EXPECTED_TOTAL);
  });

  it("names files that exist", () => {
    // A path that no longer resolves exempts nothing, so it cannot fail visibly. It just sits
    // there making the count overstate how much is left to clean up.
    for (const path of readAllowlist().keys()) {
      expect(existsSync(path), `${path} is on the allowlist but not on disk`).toBe(true);
    }
  });

  it("maps every entry to a positive whole number", () => {
    for (const [path, entry] of readAllowlist()) {
      expect(Number.isInteger(entry.count), `${path} must record an integer count`).toBe(true);
      expect(entry.count, `${path} must record a positive count`).toBeGreaterThan(0);
      expect(entry.digests, `${path} must record one digest per offence`).toHaveLength(entry.count);
    }
  });

  it("refuses a malformed file rather than reading it as empty", () => {
    // Degrading to an empty allowlist would turn every pre-existing comment into a failure and
    // present a parse error as a wave of unrelated findings.
    expect(() => readAllowlist("/nonexistent-root-for-this-test")).toThrow();
  });
});

describe("review-process tooling", () => {
  it.each([
    "scripts/ci-verdict.mjs",
    "scripts/verify-merge.mjs",
    "scripts/release/check-changesets.mjs",
  ])("exempts %j, whose subject matter IS the review process", path => {
    expect(isReviewDomain(path)).toBe(true);
  });

  it.each([
    "packages/nextly/src/di/register.ts",
    "scripts/check-comment-convention.mjs",
    "scripts/drizzle-version.cjs",
  ])("does not exempt %j", path => {
    // The exemption is for code whose DOMAIN is pull requests, not for `scripts/` generally.
    // Widening it to the directory would take the release tooling's neighbours out of scope
    // without anyone choosing that.
    expect(isReviewDomain(path)).toBe(false);
  });
});


/**
 * The CLI itself, run as a process.
 *
 * Everything above exercises exported functions, and none of it reaches the parts that decide
 * whether CI passes: the walk feeding `byFile`, the comparison against the allowlist, and the
 * exit status. Disconnecting any of those leaves all the assertions above green while the gate
 * reports success on a repository full of offences.
 *
 * So this runs the real entry point against a fixture tree and reads the exit code, which is the
 * only thing a CI step consults.
 */
describe("the command", () => {
  const CHECKER = new URL("check-comment-convention.mjs", import.meta.url).pathname;

  /** A throwaway repository holding one offence, with the allowlist the run should consult. */
  function fixture(allowlist) {
    const root = mkdtempSync(joinPath(tmpdir(), "comment-gate-"));
    mkdirSync(joinPath(root, "scripts"), { recursive: true });
    mkdirSync(joinPath(root, "packages"), { recursive: true });
    writeFileSync(
      joinPath(root, "scripts", "comment-convention-allowlist.json"),
      `${JSON.stringify(allowlist, null, 2)}\n`
    );
    writeFileSync(joinPath(root, "packages", "offender.ts"), "// Codex asked for this\nexport const x = 1;\n");
    // Tracked-ness decides what the walk reads, so the fixture needs to be a repository.
    for (const args of [["init", "-q"], ["add", "-A"]]) {
      spawnSync("git", args, { cwd: root });
    }
    return root;
  }

  const run = root => spawnSync(process.execPath, [CHECKER, "packages"], { cwd: root, encoding: "utf8" });

  it("exits nonzero and names the file when an offence is not allowlisted", () => {
    const root = fixture({});
    try {
      const result = run(root);
      expect(result.status, result.stderr + result.stdout).toBe(1);
      expect(result.stderr).toContain("packages/offender.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits zero when that same offence is recorded", () => {
    // The positive control. Without it the assertion above passes for a command that fails on
    // everything — a broken path, a crash on startup — and the exit code would look like the gate
    // working.
    const root = fixture({});
    try {
      const digest = digestOffences(["names a review tool — // Codex asked for this"]);
      writeFileSync(
        joinPath(root, "scripts", "comment-convention-allowlist.json"),
        `${JSON.stringify({ "packages/offender.ts": { count: 1, digests: digest } }, null, 2)}\n`
      );
      const result = run(root);
      expect(result.status, result.stderr + result.stdout).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
