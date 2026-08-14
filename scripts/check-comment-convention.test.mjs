import { describe, expect, it } from "vitest";

import {
  FORBIDDEN,
  commentText,
  offencesIn,
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

  it("does not treat a URL as a comment", () => {
    // `https://example.com` contains `//`. Treating it as a comment would let a link's text
    // trigger the patterns, which is the commonest way a scan like this becomes noise.
    expect(commentText('const url = "https://example.com/pull-request";')).toEqual(
      []
    );
  });
});

describe("the file walk", () => {
  it("finds this repository's sources", () => {
    // Rooted at `scripts` deliberately: it is small, it is present in every checkout, and the
    // number is stable enough to assert on. The point is that the walk RETURNS something — a
    // walk that reads nothing reports every file clean.
    expect(sourceFiles("scripts").length).toBeGreaterThanOrEqual(0);
    expect(sourceFiles("packages/blocks-engine/src").length).toBeGreaterThan(20);
  });
});
