/**
 * `translationCounts` is the shared derivation behind every surface that says
 * how far along a document's translations are — the panel's meter, the header's
 * spoken region, the list's badge. It is tested directly rather than through any
 * one of them, so retiring a surface cannot take its coverage.
 */

import { describe, expect, it } from "vitest";

import {
  languageState,
  languageStateLabel,
  translationCounts,
  untranslatedLocales,
} from "../translation-meta";

const CODES = ["en", "es", "fr", "de"] as const;
const DEFAULT = "en";

describe("translationCounts", () => {
  it("counts only languages that carry a translation", () => {
    const counts = translationCounts(
      {
        en: { translated: true, status: "published" },
        es: { translated: true, status: "draft" },
        fr: { translated: false },
      },
      CODES
    );
    // Every configured language is counted, the default included: `en` and
    // `es` carry content, `en` is live.
    expect(counts).toEqual({ translated: 2, published: 1, total: 4 });
  });

  it("counts the default language on both sides of the count", () => {
    // Every language a reader can be shown is counted, the default among
    // them: a document with only its default written has one of its three
    // languages, and every surface reading this count says so alike.
    const counts = translationCounts(
      { en: { translated: true, status: "published" } },
      ["en", "es", "ar"]
    );
    expect(counts).toEqual({ translated: 1, published: 1, total: 3 });
  });

  it("counts a language absent from the map as untranslated", () => {
    // `de` is configured but has no entry at all, which is different from an
    // entry saying `translated: false` and must count the same way.
    const counts = translationCounts(
      { en: { translated: true }, es: { translated: true } },
      CODES
    );
    expect(counts).toEqual({ translated: 2, published: 0, total: 4 });
  });

  it("treats a missing map as nothing translated rather than as an error", () => {
    expect(translationCounts(undefined, CODES)).toEqual({
      translated: 0,
      published: 0,
      total: 4,
    });
  });

  it("ignores locales the app does not configure", () => {
    // The map can carry a language that was removed from the config. Counting
    // it would report progress against a denominator that does not include it,
    // so "4 of 3" becomes possible.
    const counts = translationCounts(
      {
        es: { translated: true, status: "published" },
        zz: { translated: true, status: "published" },
      },
      CODES
    );
    expect(counts.translated).toBe(1);
    expect(counts.total).toBe(4);
  });

  it("never reports more published than translated", () => {
    // published is a subset of translated by construction; a language marked
    // published without being translated would otherwise make the bar's second
    // segment negative.
    const counts = translationCounts(
      { es: { translated: false, status: "published" } },
      CODES
    );
    expect(counts.published).toBeLessThanOrEqual(counts.translated);
    expect(counts.published).toBe(0);
  });

  it("counts the one language an app configures nothing beside", () => {
    expect(translationCounts({ en: { translated: true } }, ["en"])).toEqual({
      translated: 1,
      published: 0,
      total: 1,
    });
  });
});

describe("untranslatedLocales", () => {
  const LOCALES = [
    { code: "en", label: "English" },
    { code: "es", label: "Spanish" },
    { code: "ar", label: "Arabic" },
  ];

  it("names the languages still awaiting a translation", () => {
    expect(
      untranslatedLocales(
        { en: { translated: true }, es: { translated: true } },
        LOCALES
      )
    ).toEqual(["Arabic"]);
  });

  it("names every language without content, the default included", () => {
    expect(untranslatedLocales(undefined, LOCALES)).toEqual([
      "English",
      "Spanish",
      "Arabic",
    ]);
  });

  it("agrees with the count it sits beside", () => {
    // Two answers to "what is left" that can disagree is the defect this whole
    // module exists to prevent, so the pairing is asserted rather than assumed.
    const translations = { es: { translated: true } };
    const { translated, total } = translationCounts(
      translations,
      LOCALES.map(l => l.code)
    );
    expect(untranslatedLocales(translations, LOCALES)).toHaveLength(
      total - translated
    );
  });
});

describe("staleness is a qualifier, not a state", () => {
  it("still classifies a stale translation by the state it is IN", () => {
    // 🔴 The decision the whole vocabulary rests on. `languageState` returns
    // exactly one value per locale, so had `stale` been added to
    // `LANGUAGE_STATES` this would answer "stale" and the entry list's dots,
    // the header control and this panel would all stop reporting a live
    // translation as live. A translation whose source moved is still published;
    // it just also needs a look.
    expect(
      languageState({ translated: true, status: "published", stale: true })
    ).toBe("published");
    expect(
      languageState({ translated: true, status: "draft", stale: true })
    ).toBe("draft");
  });

  it("appends the qualifier to the state rather than replacing it", () => {
    expect(languageStateLabel("published", { stale: true })).toBe(
      "published · source changed since"
    );
    // The control: without the flag the label is untouched, so the appending is
    // conditional rather than the state having been rewritten.
    expect(languageStateLabel("published")).toBe("published");
  });

  it("carries both qualifiers at once, in a fixed order", () => {
    // They are independent facts and either can hold alone, so a label that
    // showed only one would drop something an author has to act on. Order is
    // pinned because a row whose markers reorder by which happens to be set
    // reads as a different kind of row.
    expect(
      languageStateLabel("published", { pendingChange: true, stale: true })
    ).toBe("published · source changed since · unpublished changes");
  });

  it("says nothing when staleness is unknown", () => {
    // Absent is not false. A translation written before `_updated_at` existed
    // reports no flag, and must not be labelled either stale OR explicitly
    // current -- the label simply does not raise the question.
    expect(languageStateLabel("translated", {})).toBe("translated");
  });
});
