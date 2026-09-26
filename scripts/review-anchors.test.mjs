/**
 * The anchor check the review bot's post job runs before it posts: which of a
 * review's comments GitHub anchors to a line of the diff, which become
 * file-level threads, and which stop the post. GitHub refuses a whole review
 * over one comment it cannot anchor, so each case below is one shape of hunk
 * it anchors a comment on, or does not.
 */
import { describe, expect, it } from "vitest";

import { anchors, shownLines, splitComments } from "./review-anchors.mjs";

/**
 * Two hunks. The first shows new lines 1 to 3 around an added line 2. The
 * second shows new line 9, removes old lines 9 and 10, then shows new line 10
 * and adds new line 11.
 */
const PATCH = ["@@ -1,2 +1,3 @@", " one", "+two", " three", "@@ -8,4 +9,3 @@", " eight", "-nine", "-ten", " eleven", "+twelve", "\\ No newline at end of file"].join("\n");
const FILES = [{ filename: "src/a.ts", patch: PATCH }, { filename: "logo.png" }];
const SHOWN = new Map(FILES.map(file => [file.filename, shownLines(file.patch)]));

describe("the lines a patch shows", () => {
  it("numbers the new file's added and context lines, and the old file's removed ones, by hunk", () => {
    const shown = shownLines(PATCH);
    expect([...shown.RIGHT]).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [9, 1],
      [10, 1],
      [11, 1],
    ]);
    expect([...shown.LEFT]).toEqual([
      [9, 1],
      [10, 1],
    ]);
  });

  it("counts an added line on the new side only, so a line removed after it keeps its old number", () => {
    const shown = shownLines("@@ -20,3 +20,3 @@\n+added\n kept\n-removed\n last");
    expect([...shown.LEFT]).toEqual([[21, 0]]);
    expect([...shown.RIGHT]).toEqual([
      [20, 0],
      [21, 0],
      [22, 0],
    ]);
  });

  it("reads a hunk header that leaves out a one-line count, as GitHub writes a single-line hunk", () => {
    const shown = shownLines("@@ -5 +5 @@\n-old\n+new");
    expect([...shown.LEFT]).toEqual([[5, 0]]);
    expect([...shown.RIGHT]).toEqual([[5, 0]]);
  });

  it("reads nothing before the first hunk header, such as a diff's own file header lines", () => {
    const shown = shownLines("--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new");
    expect([...shown.LEFT]).toEqual([[1, 0]]);
    expect([...shown.RIGHT]).toEqual([[1, 0]]);
  });

  it("shows no line of a file GitHub lists without a patch", () => {
    expect(shownLines(undefined)).toEqual({ LEFT: new Map(), RIGHT: new Map() });
  });
});

describe("whether GitHub anchors a comment", () => {
  it.each([
    ["an added line", { line: 2, side: "RIGHT" }, true],
    ["a context line", { line: 3, side: "RIGHT" }, true],
    ["a removed line, on the old side", { line: 9, side: "LEFT" }, true],
    ["a line with no side given, read as the new side", { line: 11 }, true],
    ["a range within one hunk", { start_line: 9, line: 11, side: "RIGHT" }, true],
    ["a line between the hunks", { line: 5, side: "RIGHT" }, false],
    ["a context line addressed on the old side", { line: 8, side: "LEFT" }, false],
    ["a range across two hunks", { start_line: 2, line: 10, side: "RIGHT" }, false],
    ["a range starting on a line the diff does not show", { start_line: 5, line: 10, side: "RIGHT" }, false],
    ["a range whose start comes after its end", { start_line: 11, line: 9, side: "RIGHT" }, false],
    ["a range starting on the other side", { start_line: 9, start_side: "LEFT", line: 10, side: "RIGHT" }, false],
    ["a comment that names no line", {}, false],
  ])("%s: %s", (_, where, anchored) => {
    expect(anchors({ path: "src/a.ts", body: "b", ...where }, SHOWN)).toBe(anchored);
  });

  it("anchors nothing on a file with no patch, or one the diff does not change", () => {
    expect(anchors({ path: "logo.png", line: 1, body: "b" }, SHOWN)).toBe(false);
    expect(anchors({ path: "src/b.ts", line: 2, body: "b" }, SHOWN)).toBe(false);
  });
});

describe("the review posted, and its file-level comments", () => {
  it("keeps the comments that anchor inline, and makes the rest file-level comments on their files", () => {
    const inline = { path: "src/a.ts", line: 2, side: "RIGHT", body: "shown" };
    const review = {
      commit_id: "abc1234",
      event: "COMMENT",
      body: "summary",
      comments: [
        inline,
        { path: "src/a.ts", line: 40, side: "RIGHT", body: "a line the diff does not show" },
        { path: "src/a.ts", start_line: 2, line: 10, side: "RIGHT", body: "a range across hunks" },
        { path: "logo.png", body: "about the file" },
      ],
    };
    const { review: posted, fileComments } = splitComments(review, FILES);
    expect(posted).toEqual({ ...review, comments: [inline] });
    expect(fileComments).toEqual([
      { path: "src/a.ts", body: "_About line 40, which the diff does not show inline._\n\na line the diff does not show" },
      { path: "src/a.ts", body: "_About lines 2–10, which the diff does not show inline._\n\na range across hunks" },
      { path: "logo.png", body: "about the file" },
    ]);
  });

  it("posts each comment kept inline with the sides it was checked on, a range's start side included", () => {
    const review = {
      body: "summary",
      comments: [
        { path: "src/a.ts", line: 2, body: "no side" },
        { path: "src/a.ts", start_line: 9, line: 11, body: "a range with no side" },
        { path: "src/a.ts", start_line: 9, line: 10, side: "LEFT", body: "a range on the old side" },
      ],
    };
    expect(splitComments(review, FILES).review.comments).toEqual([
      { path: "src/a.ts", line: 2, side: "RIGHT", body: "no side" },
      { path: "src/a.ts", start_line: 9, start_side: "RIGHT", line: 11, side: "RIGHT", body: "a range with no side" },
      { path: "src/a.ts", start_line: 9, start_side: "LEFT", line: 10, side: "LEFT", body: "a range on the old side" },
    ]);
  });

  it("refuses a comment on a file the diff does not change, since it could open no thread", () => {
    const review = { body: "summary", comments: [{ path: "src/b.ts", line: 1, body: "elsewhere" }] };
    expect(() => splitComments(review, FILES)).toThrow("a comment is on src/b.ts, which the diff does not change");
  });

  it.each([
    ["no path", { line: 2, body: "b" }],
    ["no body", { path: "src/a.ts", line: 2 }],
    ["not an object", "src/a.ts:2"],
  ])("refuses a comment with %s", (_, comment) => {
    expect(() => splitComments({ body: "summary", comments: [comment] }, FILES)).toThrow("a comment is not an object with a string path and body");
  });
});
