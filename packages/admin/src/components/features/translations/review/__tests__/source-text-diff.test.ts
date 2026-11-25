/**
 * The marks are only worth reading if both texts can be read back out of them,
 * so every comparison here goes through `runsBetween`, which checks that before
 * the case's own property is looked at.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TextSegment } from "@admin/services/versionApi";

import { changeInWords, diffSourceText } from "../source-text-diff";

const joined = (runs: readonly TextSegment[]): string =>
  runs.map(run => run.text).join("");

const removedIn = (runs: readonly TextSegment[]): TextSegment[] =>
  runs.filter(run => run.op === -1);

const addedIn = (runs: readonly TextSegment[]): TextSegment[] =>
  runs.filter(run => run.op === 1);

const keptIn = (runs: readonly TextSegment[]): TextSegment[] =>
  runs.filter(run => run.op === 0);

/** The runs from one text to the other, once both read back out of them. */
function runsBetween(before: string, after: string): TextSegment[] {
  const runs = diffSourceText(before, after);
  expect(joined(runs.filter(run => run.op !== 1))).toBe(before);
  expect(joined(runs.filter(run => run.op !== -1))).toBe(after);
  // An empty run would be drawn as an empty mark, and counted as a passage.
  expect(runs.filter(run => run.text === "")).toEqual([]);
  return runs;
}

/** That many different lines, each with its line break. */
const rows = (count: number): string =>
  Array.from({ length: count }, (_, index) => `row ${index}\n`).join("");

/** A text whose first and last line carry the word, around the same middle. */
const around = (word: string, middle: string): string =>
  `${word} opening\n${middle}${word} closing`;

describe("diffSourceText", () => {
  it("marks one changed word and keeps the rest", () => {
    expect(runsBetween("The quick fox runs", "The slow fox runs")).toEqual([
      { op: 0, text: "The " },
      { op: -1, text: "quick" },
      { op: 1, text: "slow" },
      { op: 0, text: " fox runs" },
    ]);
  });

  it("marks two changed words apart and keeps what stands between them", () => {
    expect(runsBetween("red the big the fox", "blue the big the cat")).toEqual([
      { op: -1, text: "red" },
      { op: 1, text: "blue" },
      { op: 0, text: " the big the " },
      { op: -1, text: "fox" },
      { op: 1, text: "cat" },
    ]);
  });

  it("keeps identical texts whole", () => {
    expect(runsBetween("The same text.", "The same text.")).toEqual([
      { op: 0, text: "The same text." },
    ]);
  });

  it("marks everything as added where there was no text before", () => {
    expect(runsBetween("", "Two words")).toEqual([
      { op: 1, text: "Two words" },
    ]);
  });

  it("marks everything as removed where there is no text after", () => {
    expect(runsBetween("Two words", "")).toEqual([
      { op: -1, text: "Two words" },
    ]);
  });

  it("has no runs where both texts are empty", () => {
    expect(runsBetween("", "")).toEqual([]);
  });

  it("marks one changed Arabic word", () => {
    expect(runsBetween("هذا كتاب قديم", "هذا كتاب جديد")).toEqual([
      { op: 0, text: "هذا كتاب " },
      { op: -1, text: "قديم" },
      { op: 1, text: "جديد" },
    ]);
  });

  it("marks the whole Arabic word where only a vowel mark differs", () => {
    // Fatha (U+064E) and kasra (U+0650) on the same letters: a mark drawn
    // without its letter cannot be read.
    expect(runsBetween("هذا ع\u064Eلم كبير", "هذا ع\u0650لم كبير")).toEqual([
      { op: 0, text: "هذا " },
      { op: -1, text: "ع\u064Eلم" },
      { op: 1, text: "ع\u0650لم" },
      { op: 0, text: " كبير" },
    ]);
  });

  it("divides a language written without spaces into words", () => {
    // Where exactly its words divide is the runtime's to say, so only the
    // changed word and the kept text are looked at.
    const runs = runsBetween("私は犬が好きです", "私は猫が好きです");
    expect(joined(removedIn(runs))).toContain("犬");
    expect(joined(addedIn(runs))).toContain("猫");
    expect(joined(keptIn(runs))).not.toBe("");
  });

  it("keeps the line breaks between two replaced paragraphs", () => {
    expect(
      runsBetween("one two\n\nthree four", "uno dos\n\ntres cuatro")
    ).toEqual([
      { op: -1, text: "one two" },
      { op: 1, text: "uno dos" },
      { op: 0, text: "\n\n" },
      { op: -1, text: "three four" },
      { op: 1, text: "tres cuatro" },
    ]);
  });

  it.each([
    ["a carriage return", "\r"],
    ["a line separator", String.fromCodePoint(0x2028)],
    ["a paragraph separator", String.fromCodePoint(0x2029)],
  ])("keeps %s between two replaced words", (_name, lineBreak) => {
    expect(runsBetween(`one${lineBreak}two`, `uno${lineBreak}dos`)).toEqual([
      { op: -1, text: "one" },
      { op: 1, text: "uno" },
      { op: 0, text: lineBreak },
      { op: -1, text: "two" },
      { op: 1, text: "dos" },
    ]);
  });

  it("marks only the paragraph added between two others", () => {
    expect(runsBetween("First.\nLast.", "First.\nMiddle.\nLast.")).toEqual([
      { op: 0, text: "First.\n" },
      { op: 1, text: "Middle.\n" },
      { op: 0, text: "Last." },
    ]);
  });

  it("reads a replaced phrase as one removal and one addition", () => {
    expect(runsBetween("The red fox sleeps", "The blue cat sleeps")).toEqual([
      { op: 0, text: "The " },
      { op: -1, text: "red fox" },
      { op: 1, text: "blue cat" },
      { op: 0, text: " sleeps" },
    ]);
  });

  it("reads a phrase replaced by one of another length as one change", () => {
    expect(runsBetween("The quick brown fox", "The slow dog")).toEqual([
      { op: 0, text: "The " },
      { op: -1, text: "quick brown fox" },
      { op: 1, text: "slow dog" },
    ]);
  });

  it("keeps a space with only insertions around it", () => {
    expect(runsBetween(" ", "one two")).toEqual([
      { op: 1, text: "one" },
      { op: 0, text: " " },
      { op: 1, text: "two" },
    ]);
  });

  it("keeps a space after an insertion and before a replaced word", () => {
    expect(runsBetween("Stop now", "Stop! wait")).toEqual([
      { op: 0, text: "Stop" },
      { op: 1, text: "!" },
      { op: 0, text: " " },
      { op: -1, text: "now" },
      { op: 1, text: "wait" },
    ]);
  });

  it("keeps a space after a replaced word and before an insertion", () => {
    expect(runsBetween("now stop", "wait (stop")).toEqual([
      { op: -1, text: "now" },
      { op: 1, text: "wait" },
      { op: 0, text: " " },
      { op: 1, text: "(" },
      { op: 0, text: "stop" },
    ]);
  });

  it("marks one of a repeated word, and counts the other once", () => {
    // What both texts begin with and what both end with overlap here.
    expect(runsBetween("the the cat", "the cat")).toEqual([
      { op: 0, text: "the " },
      { op: -1, text: "the " },
      { op: 0, text: "cat" },
    ]);
    expect(runsBetween("the cat", "the the cat")).toEqual([
      { op: 0, text: "the " },
      { op: 1, text: "the " },
      { op: 0, text: "cat" },
    ]);
  });

  it("still marks one word in a long text where little changed", () => {
    const start = rows(300);
    expect(
      runsBetween(
        `${start}the old end\n${start}`,
        `${start}the new end\n${start}`
      )
    ).toEqual([
      { op: 0, text: `${start}the ` },
      { op: -1, text: "old" },
      { op: 1, text: "new" },
      { op: 0, text: ` end\n${start}` },
    ]);
  });

  it("compares a text too long for its words by its lines", () => {
    // Over a thousand words between the two changes on each side, and a few
    // hundred lines.
    const middle = rows(300);
    expect(runsBetween(around("old", middle), around("new", middle))).toEqual([
      { op: -1, text: "old opening\n" },
      { op: 1, text: "new opening\n" },
      { op: 0, text: middle },
      { op: -1, text: "old closing" },
      { op: 1, text: "new closing" },
    ]);
  });

  it("compares a text too long for its lines as a whole", () => {
    // The same text as above but for its length: over a thousand lines.
    const middle = rows(1000);
    const before = around("old", middle);
    const after = around("new", middle);
    expect(runsBetween(before, after)).toEqual([
      { op: -1, text: before },
      { op: 1, text: after },
    ]);
  });
});

describe("diffSourceText where the runtime does not divide words", () => {
  beforeEach(() => {
    // Everything else of it is inherited, and nothing on the real one changes.
    vi.stubGlobal(
      "Intl",
      Object.create(Intl, { Segmenter: { value: undefined } })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes a text without spaces as one word", () => {
    // Proves the cases below are not divided by the runtime: where they are,
    // the rest of this sentence is kept.
    expect(runsBetween("私は犬が好きです", "私は猫が好きです")).toEqual([
      { op: -1, text: "私は犬が好きです" },
      { op: 1, text: "私は猫が好きです" },
    ]);
  });

  it("marks one changed word and keeps the rest", () => {
    expect(runsBetween("The quick fox runs", "The slow fox runs")).toEqual([
      { op: 0, text: "The " },
      { op: -1, text: "quick" },
      { op: 1, text: "slow" },
      { op: 0, text: " fox runs" },
    ]);
  });

  it("marks the whole Arabic word where only a vowel mark differs", () => {
    expect(runsBetween("هذا ع\u064Eلم كبير", "هذا ع\u0650لم كبير")).toEqual([
      { op: 0, text: "هذا " },
      { op: -1, text: "ع\u064Eلم" },
      { op: 1, text: "ع\u0650لم" },
      { op: 0, text: " كبير" },
    ]);
  });

  it("keeps the punctuation after a changed word", () => {
    expect(runsBetween("Stop now!", "Stop here!")).toEqual([
      { op: 0, text: "Stop " },
      { op: -1, text: "now" },
      { op: 1, text: "here" },
      { op: 0, text: "!" },
    ]);
  });

  it("marks a changed emoji whole", () => {
    // Both begin with the same half of a surrogate pair, which on its own is
    // not a character.
    expect(runsBetween("fine \u{1F600}", "fine \u{1F601}")).toEqual([
      { op: 0, text: "fine " },
      { op: -1, text: "\u{1F600}" },
      { op: 1, text: "\u{1F601}" },
    ]);
  });

  it("keeps the line breaks between two replaced paragraphs", () => {
    expect(
      runsBetween("one two\n\nthree four", "uno dos\n\ntres cuatro")
    ).toEqual([
      { op: -1, text: "one two" },
      { op: 1, text: "uno dos" },
      { op: 0, text: "\n\n" },
      { op: -1, text: "three four" },
      { op: 1, text: "tres cuatro" },
    ]);
  });
});

describe("changeInWords", () => {
  const kept: TextSegment = { op: 0, text: "kept" };
  const removed: TextSegment = { op: -1, text: "gone" };
  const added: TextSegment = { op: 1, text: "new" };

  it.each<[string, TextSegment[], string | undefined]>([
    ["no text", [], undefined],
    ["only kept text", [kept], undefined],
    ["one removal", [kept, removed], "1 passage removed (struck through)."],
    [
      "two removals",
      [removed, kept, removed],
      "2 passages removed (struck through).",
    ],
    ["one addition", [added, kept], "1 passage added (underlined)."],
    ["two additions", [added, kept, added], "2 passages added (underlined)."],
    [
      "one of each",
      [removed, added],
      "1 passage removed (struck through) and 1 passage added (underlined).",
    ],
    [
      "one removal and two additions",
      [removed, added, kept, added],
      "1 passage removed (struck through) and 2 passages added (underlined).",
    ],
    [
      "two removals and one addition",
      [removed, added, kept, removed],
      "2 passages removed (struck through) and 1 passage added (underlined).",
    ],
  ])("says what changed for %s", (_name, segments, sentence) => {
    expect(changeInWords(segments)).toBe(sentence);
  });

  it("counts a replaced phrase once on each side", () => {
    expect(
      changeInWords(runsBetween("The red fox sleeps", "The blue cat sleeps"))
    ).toBe(
      "1 passage removed (struck through) and 1 passage added (underlined)."
    );
  });

  it("says nothing of texts with the same wording", () => {
    expect(changeInWords(runsBetween("The same", "The same"))).toBeUndefined();
  });
});
