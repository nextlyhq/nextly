/**
 * TranslationStatus — one instrument for "how far along are the translations".
 *
 * `translationCounts` is the shared derivation: the visible bar and the
 * header's spoken region both read it, so it is tested directly rather than
 * only through what the component renders.
 */

import { describe, expect, it } from "vitest";

import { translationCounts } from "../TranslationStatus";

const CODES = ["en", "es", "fr", "de"] as const;

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
    expect(counts).toEqual({ translated: 2, published: 1, total: 4 });
  });

  it("counts a language absent from the map as untranslated", () => {
    // `de` is configured but has no entry at all, which is different from an
    // entry saying `translated: false` and must count the same way.
    const counts = translationCounts(
      { en: { translated: true, status: "published" } },
      CODES
    );
    expect(counts).toEqual({ translated: 1, published: 1, total: 4 });
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
    // so `5 of 4` becomes possible.
    const counts = translationCounts(
      {
        en: { translated: true, status: "published" },
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
      { en: { translated: false, status: "published" } },
      CODES
    );
    expect(counts.published).toBeLessThanOrEqual(counts.translated);
    expect(counts.published).toBe(0);
  });

  it("reports zero total when no locales are configured", () => {
    expect(translationCounts({ en: { translated: true } }, [])).toEqual({
      translated: 0,
      published: 0,
      total: 0,
    });
  });
});
