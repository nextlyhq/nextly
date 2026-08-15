/**
 * Controls for the repository-wide comment-convention gate.
 *
 * This suite SUPERSEDES `packages/blocks-engine/src/comment-convention.test.ts`, which this
 * change deletes. That suite rooted the same rule inside one package: it walked from its own
 * directory, so it enforced the convention for `blocks-engine` while reading, from the outside,
 * as though it covered the repository. The gate these tests exercise scans every tracked source
 * file, so the coverage moved here rather than disappearing.
 *
 * What moved with it, and what did not: the forbidden shapes, the comment extraction and the
 * file walk are all covered below. The deleted suite carried no assertion this one lacks.
 */

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
  normaliseComment,
  readAllowlist,
  readOptionsFor,
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
    // Pinned independently of SOURCE_EXTENSIONS. Iterating the exported list alone makes the
    // assertion vacuous for a deleted entry: drop ".cjs" from the code and the loop simply stops
    // asking about it, so tracked .cjs files leave CI with every test still green.
    for (const required of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".css", ".yml", ".yaml", ".sh"]) {
      expect(SOURCE_EXTENSIONS, `${required} is no longer scanned`).toContain(required);
    }

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
    // "." is listed because it is what reaches the repository ROOT, where eslint.config.mjs and
    // lint-staged.config.mjs live. The named roots below it are covered by "." and kept because
    // they are what the scope MEANS to a reader; dropping "." alone would silently narrow it.
    for (const required of [".", "packages", "apps", "e2e", "templates", "scripts"]) {
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
  // than a record of what predates it. Lower these as entries are removed.
  //
  // Raising them is legitimate in exactly one case, which is why these numbers moved once: when
  // the scan WIDENS to files it previously skipped, whatever those files already contained is by
  // definition pre-existing. The checker's own source came out of EXCLUDED_FILES and brought 12
  // recorded offences with it. A raise for any other reason is the silencing this guards against.
  const EXPECTED_ENTRIES = 209;
  const EXPECTED_TOTAL = 402;

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

describe("normalised comment text", () => {
  it("is stable across reflow of a block comment", () => {
    // A block comment carries a `*` on every continuation line, so collapsing whitespace alone is
    // not reflow-stable. Without this, re-wrapping prose nobody edited makes the blocking check
    // report an unrecorded offence - a gate blocking ordinary formatting.
    const wrapped = normaliseComment("/** one two and\n * three four. */");
    const flat = normaliseComment("/** one two and three four. */");
    expect(wrapped).toBe(flat);
  });

  it("does not eat a closing delimiter", () => {
    // The decoration strip must not consume `*/`, which would merge the comment with what follows.
    expect(normaliseComment("/* a\n */")).toBe("/* a */");
  });
});

describe("the checker's own source", () => {
  it("may quote the shapes it forbids", () => {
    // Its SUBJECT is the convention, so the patterns and the prose explaining them are domain
    // vocabulary. Four CI failures came from an explanation instantiating its own pattern.
    expect(
      offencesIn(
        "// naming a review round is the shape this rejects",
        readOptionsFor("scripts/check-comment-convention.mjs")
      )
    ).toEqual([]);
  });

  it("is still held to genuine narration", () => {
    // The exemption covers domain vocabulary and nothing else, so the file is not waved through.
    for (const line of ["// The founder asked for this", "// Task 17: do the thing"]) {
      expect(
        offencesIn(line, readOptionsFor("scripts/check-comment-convention.mjs")).length
      ).toBeGreaterThan(0);
    }
  });
});

describe("actors that can be runtime concepts", () => {
  it("allows a reviewer or maintainer as a runtime actor in review tooling", () => {
    // Code that models review behaviour treats a change request from one of these actors as a
    // state, not as something someone told the author. Outside review tooling the same wording is
    // a conversation. Phrased to describe the shape rather than instantiate it: the fixtures below
    // carry the literal forms, and a comment that spells one out is itself an offence.
    expect(
      offencesIn(
        "// The reviewer requested changes, so the verdict stays blocked",
        readOptionsFor("scripts/verify-merge.mjs")
      )
    ).toEqual([]);
    expect(
      offencesIn(
        "// The reviewer requested changes",
        readOptionsFor("packages/nextly/src/x.ts")
      ).length
    ).toBeGreaterThan(0);
  });

  it("still forbids a founder or a tool even in review tooling", () => {
    // Neither is ever a runtime actor, so the domain exemption must not reach them - that was the
    // hole an earlier, broader exemption opened.
    for (const line of ["// The founder asked for this", "// Codex asked for this"]) {
      expect(
        offencesIn(line, readOptionsFor("scripts/verify-merge.mjs")).length
      ).toBeGreaterThan(0);
    }
  });

  it("treats the GitHub review automation as review domain", () => {
    expect(
      offencesIn(
        "# The pull request head is checked out here",
        readOptionsFor(".github/workflows/nextly-review-bot.yml")
      )
    ).toEqual([]);
    expect(
      offencesIn(
        "# The pull request head is checked out here",
        readOptionsFor(".github/workflows/ci.yml")
      ).length
    ).toBeGreaterThan(0);
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
    "scripts/drizzle-version.cjs",
  ])("does not exempt %j", path => {
    // The exemption is for code whose DOMAIN is pull requests, not for `scripts/` generally.
    // Widening it to the directory would take the release tooling's neighbours out of scope
    // without anyone choosing that.
    expect(isReviewDomain(path)).toBe(false);
  });

  it("exempts the checker itself, whose subject IS the convention", () => {
    // This case moved out of the list above deliberately. It was excluded from the exemption and
    // its own prose recorded in the allowlist instead, on the reading that the file should be
    // held to the rule it enforces. It still is: the exemption covers domain VOCABULARY only, so
    // genuine narration in this file is reported and its remaining entries are exactly those.
    // What changed is that quoting a forbidden shape in order to explain it is the file's job,
    // and four separate CI failures came from an explanation instantiating its own pattern.
    expect(isReviewDomain("scripts/check-comment-convention.mjs")).toBe(true);
    expect(isReviewDomain("scripts/check-comment-convention.test.mjs")).toBe(true);
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
  const FIXTURE_SOURCE = "// Codex asked for this\nexport const x = 1;\n";

  /** A throwaway repository holding one offence, with the allowlist the run should consult. */
  function fixture(allowlist) {
    const root = mkdtempSync(joinPath(tmpdir(), "comment-gate-"));
    mkdirSync(joinPath(root, "scripts"), { recursive: true });
    mkdirSync(joinPath(root, "packages"), { recursive: true });
    writeFileSync(
      joinPath(root, "scripts", "comment-convention-allowlist.json"),
      `${JSON.stringify(allowlist, null, 2)}\n`
    );
    writeFileSync(joinPath(root, "packages", "offender.ts"), FIXTURE_SOURCE);
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
      // DERIVED from the checker rather than hand-written. A literal offence string here would
      // stop matching the moment a pattern is added or its `why` reworded, and the failure would
      // look like the CLI breaking rather than the fixture drifting.
      const found = offencesIn(FIXTURE_SOURCE).map(
        one => `${one.why} — ${normaliseComment(one.comment)}`
      );
      writeFileSync(
        joinPath(root, "scripts", "comment-convention-allowlist.json"),
        `${JSON.stringify(
          { "packages/offender.ts": { count: found.length, digests: digestOffences(found) } },
          null,
          2
        )}\n`
      );
      const result = run(root);
      expect(result.status, result.stderr + result.stdout).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("numbered task and plan labels", () => {
  // A hash between the noun and the number is the canonical written form and is exactly what the
  // pattern exists to catch, so requiring the digit to follow the noun immediately left the
  // commonest spelling passing. The fixtures below carry the literal shapes; this comment cannot,
  // because the extractor reads comment text and would report it.
  it("matches a hash-prefixed number", () => {
    expect(offencesIn("// Task #17: migrate the records").length).toBeGreaterThan(0);
    expect(offencesIn("// Plan #12: split the adapter").length).toBeGreaterThan(0);
  });

  it("still matches the bare number", () => {
    expect(offencesIn("// Task 17: migrate the records").length).toBeGreaterThan(0);
  });

  it("does not match numbered runtime concepts", () => {
    // A number alone does not separate a label from ordinary technical English: a scheduler
    // really does assign work items by number, and a query planner really does number its plans.
    expect(offencesIn("// The scheduler assigns task 17 to worker 2")).toEqual([]);
    expect(offencesIn("// Query plan 2 is invalidated when the schema changes")).toEqual([]);
  });

  it("matches the parenthesised label form", () => {
    // The second unambiguous shape. Prose does not bracket a runtime concept this way.
    expect(offencesIn("/** @since v0.0.3-alpha (Plan D4) */").length).toBeGreaterThan(0);
  });

  it("does not match a bare plan colon in ordinary prose", () => {
    // "query plan", "execution plan" and "cache the plan" are ordinary technical English. Matching
    // a bare `plan:` rejected correct comments describing runtime behaviour, and a check that
    // rejects correct comments gets switched off rather than fixed.
    expect(offencesIn("// The query plan: use an index scan to avoid sorting")).toEqual([]);
    expect(offencesIn("// execution plan: nested loop")).toEqual([]);
  });

  it("does not match ordinary prose about a task", () => {
    // The negative control the widening must not break: "task" is an ordinary word.
    expect(offencesIn("// the task queue drains oldest first")).toEqual([]);
  });
});

describe("interpreter directives", () => {
  it("skips a shebang only in shell", () => {
    // A shebang is an interpreter directive rather than prose, but YAML has no shebang: there a
    // first line beginning `#!` is simply a comment, and skipping it unconditionally left the
    // first line of every YAML file unreadable.
    expect(offencesIn("#!/bin/sh\necho hi", readOptionsFor("f.sh"))).toEqual([]);
    expect(
      offencesIn(`#! ${"Codex"} asked for this\nkey: value`, readOptionsFor("f.yml")).length
    ).toBeGreaterThan(0);
  });
});

describe("the hash dialects", () => {
  // Narration the patterns must match, so each case below turns on WHERE the text sits rather
  // than on what it says. Asserting the offence NAMES this string keeps a case from passing on
  // some unrelated finding in the same fixture.
  const NARRATION = "Codex asked for this";
  const shell = source => offencesIn(source, readOptionsFor("fixture.sh"));
  const yaml = source => offencesIn(source, readOptionsFor("fixture.yml"));
  const names = found => found.some(one => one.comment.includes(NARRATION));

  describe("shell heredocs", () => {
    // A heredoc body is data the script EMITS - a generated file, a payload, an embedded
    // snippet - so a `#` there is content rather than authored prose. Reporting it fails CI on
    // legal shell, and a gate that rejects valid input gets switched off rather than fixed.
    it("does not read a quoted heredoc body", () => {
      expect(names(shell(`cat <<'EOF'\n# ${NARRATION}\nEOF\n`))).toBe(false);
    });

    it("does not read an unquoted heredoc body", () => {
      expect(names(shell(`cat <<EOF\n# ${NARRATION}\nEOF\n`))).toBe(false);
    });

    it("does not read a tab-stripped heredoc body", () => {
      // `<<-` allows the terminator to be indented with tabs, so a body that ends `\tEOF` closes
      // it. Matching the delimiter literally would leave the heredoc open to end of file.
      expect(names(shell(`cat <<-EOF\n# ${NARRATION}\n\tEOF\n`))).toBe(false);
    });

    it("consumes two heredocs opened on one line in order", () => {
      expect(names(shell(`cmd <<A <<B\n# ${NARRATION}\nA\n# ${NARRATION}\nB\n`))).toBe(false);
    });

    it("quote-removes the whole delimiter word", () => {
      // The shell reads `<<'E'OF` as the single word EOF. Stopping at the first closing quote
      // names `E`, no later line matches the terminator, and every remaining line is suppressed -
      // a miss that grows to the end of the file.
      expect(names(shell(`cat <<'E'OF\ndata\nEOF\n# ${NARRATION}\n`))).toBe(true);
    });

    it("still treats a mixed-quoted heredoc body as data", () => {
      expect(names(shell(`cat <<'E'OF\n# ${NARRATION}\nEOF\n`))).toBe(false);
    });

    it("reads a comment after the heredoc closes", () => {
      // The positive control. Without it every assertion above is satisfied by a reader that
      // stopped at the first heredoc and never emitted anything again.
      expect(names(shell(`cat <<'EOF'\ndata\nEOF\n# ${NARRATION}\n`))).toBe(true);
    });

    it("does not treat a here-string as opening a body", () => {
      // `<<<` takes its operand on the same line, so no body follows. Reading it as a heredoc
      // would swallow every line to the end of the file.
      expect(names(shell(`grep x <<< "$var"\n# ${NARRATION}\n`))).toBe(true);
    });

    it("accepts a non-identifier delimiter", () => {
      // Bash defines the delimiter as a general word, so `123` and `EOF!` are both valid.
      // Refusing them left their bodies scanned as source and reported as comments.
      expect(names(shell(`cat <<123\n# ${NARRATION}\n123\n`))).toBe(false);
      expect(names(shell(`cat <<EOF!\n# ${NARRATION}\nEOF!\n`))).toBe(false);
    });

    it("does not treat a bare arithmetic shift as a heredoc", () => {
      // What made the shape restriction necessary, now handled by tracking `((` directly - so a
      // valid numeric delimiter is accepted without a left shift opening a body.
      expect(names(shell(`(( n = 1 << 2 ))\n# ${NARRATION}\n`))).toBe(true);
    });

    it("does not treat an arithmetic left shift as a heredoc", () => {
      // Inside `$(( ))` a `<<` is a shift operator, and its right operand is not a delimiter.
      expect(names(shell(`n=$(( 1 << 2 ))\n# ${NARRATION}\n`))).toBe(true);
    });
  });

  describe("shell command substitution", () => {
    it("reads a comment inside a substitution within double quotes", () => {
      // Shell parses `$( )` as commands whatever encloses it, so the outer double quote does not
      // make this data. Treating the quote as still open here is a false NEGATIVE - narration
      // the gate exists to catch, passing because of where it sits.
      expect(names(shell(`value="$(echo ok # ${NARRATION}\n)"\n`))).toBe(true);
    });

    it("does not read a hash inside plain double quotes", () => {
      expect(names(shell(`value="literal # ${NARRATION}"\n`))).toBe(false);
    });

    it("tracks nested parentheses before restoring the outer quote", () => {
      // A subshell inside the substitution closes with the same character. Popping on it would
      // restore the enclosing double quote and read the real comment after it as data.
      expect(names(shell(`value="$( (echo ok); # ${NARRATION}\n)"`))).toBe(true);
    });

    it("honours backslash escapes inside ANSI-C quoting", () => {
      // `$'...'` is the one single-quoted form in either dialect where a backslash escapes the
      // closing quote. Reading it with the plain rule ends the string early and reports the rest
      // of a valid command as a comment.
      expect(names(shell(`printf %s $'it\\'s # ${NARRATION}'`))).toBe(false);
    });

    it("still reads a comment after ANSI-C quoting closes", () => {
      expect(names(shell(`printf %s $'ok' # ${NARRATION}`))).toBe(true);
    });

    it("does not read a substitution inside single quotes", () => {
      // Single quotes suppress substitution entirely, so this really is literal text.
      expect(names(shell(`value='$(echo ok # ${NARRATION})'\n`))).toBe(false);
    });
  });

  describe("YAML block scalars", () => {
    it("reads the header's own trailing comment", () => {
      expect(names(yaml(`description: | # ${NARRATION}\n  body\n`))).toBe(true);
    });

    it("does not read the data under a header that carried a comment", () => {
      // The pair to the case above: the header line holds prose AND opens a scalar, so the two
      // must be decided separately.
      expect(names(yaml(`description: | # plain header\n  # ${NARRATION}\n`))).toBe(false);
    });

    it("enters a scalar introduced by a sequence entry", () => {
      // `- |` has no `:` in front of it, so a header expression anchored on the colon misses it.
      expect(names(yaml(`steps:\n  - |\n    # ${NARRATION}\n`))).toBe(false);
    });

    it("enters a scalar carrying indentation and chomping indicators", () => {
      expect(names(yaml(`body: |2-\n  # ${NARRATION}\n`))).toBe(false);
    });

    it("does not treat an apostrophe in a plain scalar as opening one", () => {
      // `Don't` is ordinary content. Reading the apostrophe as a quote swallows the rest of the
      // line, and the end-of-line reset comes too late to recover the comment that followed it -
      // so the narration passes on the SAME line while a next-line control still looks green.
      expect(names(yaml(`message: Don't panic # ${NARRATION}`))).toBe(true);
    });

    it("does not treat an inch mark in a plain scalar as opening one", () => {
      expect(names(yaml(`size: 12" screen # ${NARRATION}`))).toBe(true);
    });

    it("keeps quote state across a doubled apostrophe", () => {
      // YAML escapes a single quote by DOUBLING it, so `'it''s # x'` is one scalar and the hash is
      // data. Closing on the first of the pair hands the rest of a legal value to the comment
      // scan, which rejects valid configuration - the direction that gets a gate switched off.
      expect(names(yaml(`key: 'it''s # ${NARRATION}'`))).toBe(false);
    });

    it("still closes on an ordinary single quote", () => {
      expect(names(yaml(`key: 'value' # ${NARRATION}`))).toBe(true);
    });

    it("still treats a genuinely quoted scalar as data", () => {
      // The negative half of the pair: a quote where a scalar can BEGIN does open one.
      expect(names(yaml(`key: 'value # ${NARRATION}'`))).toBe(false);
    });

    it("still reads an ordinary comment", () => {
      // The positive control for the whole dialect.
      expect(names(yaml(`key: value\n# ${NARRATION}\n`))).toBe(true);
    });
  });
});
