/**
 * The language a migration file's header records for its answers.
 *
 * What would separate a right reading from a plausible wrong one: a reading of the whole file
 * takes the record from a statement's text, and one that stops at the first line that is not the
 * record misses it among the other header lines.
 */
import { describe, expect, it } from "vitest";

import { recordedAnswerLanguage } from "../answer-language";
import { answersHeaderLine } from "../answer-language-names";

/** A file with `header` above its UP section, and a fill whose text holds the record's words. */
const fileWith = (header: string) =>
  `-- Migration: 20261021_090000_require_body
-- Collections: posts
${header}-- Generated at: 2026-10-21T09:00:00.000Z

-- UP
UPDATE "dc_posts" SET "body" = 'First
-- Answers in: es
last' WHERE "body" IS NULL;

-- DOWN
SELECT 1;
`;

describe("the language a file's answers are recorded in", () => {
  it("is the header's line, wherever it stands in the header", () => {
    expect(recordedAnswerLanguage(fileWith(answersHeaderLine("en")))).toBe(
      "en"
    );
  });

  it("is none where only a statement's text holds the words", () => {
    expect(
      recordedAnswerLanguage(fileWith(answersHeaderLine(undefined)))
    ).toBeUndefined();
    // Nor in a file with no UP marker, whose statements start at its first line that is no comment.
    expect(
      recordedAnswerLanguage("SELECT 1;\n-- Answers in: es\n")
    ).toBeUndefined();
  });
});
