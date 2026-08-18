// Counting FIELDS rather than languages.
//
// The document-level count reads the backend's stored `_translations` map and
// therefore describes what was last saved. This one reads the form's live
// values, so it moves while someone is typing — two different questions, and
// the cases below are the ones where a shared implementation would get one of
// them wrong.

import { describe, it, expect } from "vitest";

import { fieldTranslationCounts, isFieldTranslated } from "../translation-meta";

describe("isFieldTranslated", () => {
  it("counts real text", () => {
    expect(isFieldTranslated("hola")).toBe(true);
  });

  it("does not count blank or whitespace", () => {
    // Whitespace-only is what an author leaves behind after clearing a field.
    // Counting it done would report a document finished that is not.
    expect(isFieldTranslated("")).toBe(false);
    expect(isFieldTranslated("   ")).toBe(false);
    expect(isFieldTranslated(null)).toBe(false);
    expect(isFieldTranslated(undefined)).toBe(false);
  });

  it("counts a non-empty list and not an empty one", () => {
    // A chips field translated to nothing is untranslated; `[]` is truthy, so
    // the ordinary presence check gets this backwards.
    expect(isFieldTranslated(["uno"])).toBe(true);
    expect(isFieldTranslated([])).toBe(false);
  });

  it("counts a structural value, and a falsy-but-real one", () => {
    // `0` and `false` are values a translator can legitimately have set, and a
    // truthiness test would report both as outstanding work forever.
    expect(isFieldTranslated({ nodes: [] })).toBe(true);
    expect(isFieldTranslated(0)).toBe(true);
    expect(isFieldTranslated(false)).toBe(true);
  });
});

describe("fieldTranslationCounts", () => {
  it("counts only the fields it was given", () => {
    // The denominator is the TRANSLATABLE set, not the document. A shared field
    // carrying a value would otherwise inflate the count with work nobody did.
    const counts = fieldTranslationCounts(["a", "b"], {
      a: "hecho",
      b: "",
      campaign: "autumn",
    });
    expect(counts).toEqual({ translated: 1, total: 2 });
  });

  it("reports nothing outstanding for a document with no translatable fields", () => {
    expect(fieldTranslationCounts([], { a: "x" })).toEqual({
      translated: 0,
      total: 0,
    });
  });

  it("treats absent values as untranslated rather than erroring", () => {
    // A field added to the schema after this language was last written has no
    // entry at all, which is untranslated rather than a crash.
    expect(fieldTranslationCounts(["a", "b"], undefined)).toEqual({
      translated: 0,
      total: 2,
    });
  });
});
