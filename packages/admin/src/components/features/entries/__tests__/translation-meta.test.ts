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
      CODES,
      DEFAULT
    );
    // `en` is the default: the source, not a translation. Three translatable
    // languages remain, of which `es` is done.
    expect(counts).toEqual({ translated: 1, published: 0, total: 3 });
  });

  it("excludes the default language from both sides of the count", () => {
    // The case that made this worth unifying: a document with ONLY its default
    // language written has had nothing translated. Counting the default made
    // the panel read "1 of 3 translated" while the list's badge read "0/2".
    const counts = translationCounts(
      { en: { translated: true, status: "published" } },
      ["en", "es", "ar"],
      "en"
    );
    expect(counts).toEqual({ translated: 0, published: 0, total: 2 });
  });

  it("counts a language absent from the map as untranslated", () => {
    // `de` is configured but has no entry at all, which is different from an
    // entry saying `translated: false` and must count the same way.
    const counts = translationCounts(
      { en: { translated: true }, es: { translated: true } },
      CODES,
      DEFAULT
    );
    expect(counts).toEqual({ translated: 1, published: 0, total: 3 });
  });

  it("treats a missing map as nothing translated rather than as an error", () => {
    expect(translationCounts(undefined, CODES, DEFAULT)).toEqual({
      translated: 0,
      published: 0,
      total: 3,
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
      CODES,
      DEFAULT
    );
    expect(counts.translated).toBe(1);
    expect(counts.total).toBe(3);
  });

  it("never reports more published than translated", () => {
    // published is a subset of translated by construction; a language marked
    // published without being translated would otherwise make the bar's second
    // segment negative.
    const counts = translationCounts(
      { es: { translated: false, status: "published" } },
      CODES,
      DEFAULT
    );
    expect(counts.published).toBeLessThanOrEqual(counts.translated);
    expect(counts.published).toBe(0);
  });

  it("reports zero total when the app configures nothing but the default", () => {
    expect(
      translationCounts({ en: { translated: true } }, ["en"], "en")
    ).toEqual({ translated: 0, published: 0, total: 0 });
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
      untranslatedLocales({ es: { translated: true } }, LOCALES, "en")
    ).toEqual(["Arabic"]);
  });

  it("never names the default language, which is the source", () => {
    expect(untranslatedLocales(undefined, LOCALES, "en")).toEqual([
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
      LOCALES.map(l => l.code),
      "en"
    );
    expect(untranslatedLocales(translations, LOCALES, "en")).toHaveLength(
      total - translated
    );
  });
});

describe("staleness is a qualifier, not a state (i18n B2)", () => {
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
