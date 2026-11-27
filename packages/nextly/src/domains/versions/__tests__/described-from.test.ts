/**
 * What a description says it was made from: a version naming the languages described, and marks
 * that move with a part's own saves and no other's.
 */
import { describe, expect, it } from "vitest";

import { describedFrom, type DocumentStanding } from "../described-from";

const STANDING: DocumentStanding = {
  main: 7,
  languages: { en: 2, es: 3, fr: 0 },
  drafts: [
    { id: "shared-draft", locale: null, revision: 1 },
    { id: "es-draft", locale: "es", revision: 4 },
    { id: "fr-draft", locale: "fr", revision: 2 },
  ],
};

const SPANISH = { languages: ["es"], shared: false };

/** `STANDING` with one draft written again. */
const rewritten = (id: string): DocumentStanding => ({
  ...STANDING,
  drafts: STANDING.drafts.map(draft =>
    draft.id === id ? { ...draft, revision: draft.revision + 1 } : draft
  ),
});

describe("what a description was made from", () => {
  it("names the version of the document's own row and of each language described, no other's", () => {
    expect(describedFrom(STANDING, SPANISH)._rev).toBe("7.es:3");
    expect(
      describedFrom(STANDING, { languages: ["fr", "en"], shared: true })._rev
    ).toBe("7.en:2,fr:0");
    expect(describedFrom(STANDING, { languages: [], shared: true })._rev).toBe(
      "7"
    );
  });

  it("marks a language by its row and its own draft", () => {
    const { marks } = describedFrom(STANDING, SPANISH);
    for (const now of [
      { ...STANDING, languages: { ...STANDING.languages, es: 4 } },
      rewritten("es-draft"),
      {
        ...STANDING,
        drafts: STANDING.drafts.filter(draft => draft.locale !== "es"),
      },
    ]) {
      const moved = describedFrom(now, SPANISH).marks;
      expect(moved.languages.es).not.toBe(marks.languages.es);
      expect(moved.shared).toBe(marks.shared);
    }
  });

  it("marks nothing of a language not described, which its caller may not read", () => {
    const { marks } = describedFrom(STANDING, SPANISH);
    for (const now of [
      { ...STANDING, languages: { ...STANDING.languages, fr: 1 } },
      rewritten("fr-draft"),
      {
        ...STANDING,
        drafts: [
          ...STANDING.drafts,
          { id: "de-draft", locale: "de", revision: 1 },
        ],
      },
    ]) {
      expect(describedFrom(now, SPANISH).marks).toEqual(marks);
    }
  });

  it("marks the shared part by its own draft, described or not", () => {
    for (const parts of [SPANISH, { languages: ["es"], shared: true }]) {
      const { marks } = describedFrom(STANDING, parts);
      const moved = describedFrom(rewritten("shared-draft"), parts).marks;
      expect(moved.shared).not.toBe(marks.shared);
      expect(moved.languages).toEqual(marks.languages);
    }
  });

  it("marks no part for a change to the document's own row, which the version names", () => {
    const now = { ...STANDING, main: 8 };
    expect(describedFrom(now, SPANISH)).toEqual({
      _rev: "8.es:3",
      marks: describedFrom(STANDING, SPANISH).marks,
    });
  });

  it("takes a document with no languages as one part, in whichever language its draft was saved", () => {
    const untranslated = { ...STANDING, languages: {} };
    const parts = { languages: [], shared: true };
    const before = describedFrom(untranslated, parts);
    expect(before._rev).toBe("7");
    const moved = describedFrom(
      { ...rewritten("es-draft"), languages: {} },
      parts
    );
    expect(moved.marks.shared).not.toBe(before.marks.shared);
    expect(moved.marks.languages).toEqual({});
  });

  it("reads the same however the drafts were read", () => {
    const reversed = { ...STANDING, drafts: [...STANDING.drafts].reverse() };
    expect(describedFrom(reversed, SPANISH)).toEqual(
      describedFrom(STANDING, SPANISH)
    );
  });
});
