/**
 * What readers get for the fields a language leaves empty: the first language
 * it falls back to that is published with a value.
 */
import { describe, expect, it } from "vitest";

import { emptyFields, fallbackChain } from "../reader-preview";
import type { TranslationField } from "../translation-fields";

const RULES = {
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", fallbackLocale: [] },
    { code: "es", fallbackLocale: ["fr"] },
    { code: "fr", fallbackLocale: ["ar"] },
    { code: "ar", fallbackLocale: [] },
  ],
};

const row = (name: string, over: object = {}): TranslationField => ({
  field: {
    name,
    type: "text",
    ...over,
  } as unknown as TranslationField["field"],
  name,
  label: name.toUpperCase(),
});

const PUBLISHED = { translated: true, status: "published" };
const DRAFT = { translated: true, status: "draft" };

const shows = (over: Partial<Parameters<typeof emptyFields>[0]> = {}) =>
  emptyFields({
    rows: [row("title")],
    shown: { title: null },
    stored: { title: null },
    values: { title: { en: "Hello", es: null, fr: "Bonjour", ar: null } },
    translations: {
      en: PUBLISHED,
      fr: PUBLISHED,
      ar: { translated: false },
    },
    target: "es",
    rules: RULES,
    ...over,
  }).map(field => field.shows);

describe("fallbackChain", () => {
  it("is the language's own fallbacks, depth first, then the default", () => {
    expect(fallbackChain("es", RULES)).toEqual(["fr", "ar", "en"]);
    expect(fallbackChain("ar", RULES)).toEqual(["en"]);
  });

  it("is empty where reads don't fall back", () => {
    expect(fallbackChain("es", { ...RULES, fallback: false })).toEqual([]);
  });

  it("ends where languages fall back to each other", () => {
    const locales = [
      { code: "en", fallbackLocale: ["es"] },
      { code: "es", fallbackLocale: ["en"] },
    ];
    expect(fallbackChain("es", { ...RULES, locales })).toEqual(["en"]);
  });
});

describe("emptyFields", () => {
  it("names only the fields left empty, in the page's order", () => {
    const empty = emptyFields({
      rows: [row("title"), row("body"), row("note")],
      shown: { title: "", body: "Hola", note: undefined },
      stored: {},
      values: {},
      translations: {},
      target: "es",
      rules: RULES,
    });
    expect(empty.map(field => field.label)).toEqual(["TITLE", "NOTE"]);
  });

  it("takes a box drawn off, or a list drawn empty, for empty where nothing is stored", () => {
    for (const drawn of [false, []]) {
      const given = (stored: unknown) =>
        shows({ shown: { title: drawn }, stored: { title: stored } });
      expect(given(null)).toEqual(["fr"]);
      expect(given(drawn)).toEqual([]);
    }
  });

  it("keeps a value of spaces, zero or false, as a read does", () => {
    for (const value of [" ", 0, false]) {
      expect(
        shows({ shown: { title: value }, stored: { title: value } })
      ).toEqual([]);
    }
  });

  it("shows the first language of the chain with a value", () => {
    expect(shows()).toEqual(["fr"]);
    expect(
      shows({ values: { title: { en: "Hello", fr: "", ar: null } } })
    ).toEqual(["en"]);
  });

  it("passes over a language in draft", () => {
    const ar = { translated: false };
    expect(shows({ translations: { en: PUBLISHED, fr: DRAFT, ar } })).toEqual([
      "en",
    ]);
    expect(shows({ translations: { en: DRAFT, fr: DRAFT, ar } })).toEqual([
      null,
    ]);
  });

  it("shows nothing where no language holds a value, or reads don't fall back", () => {
    expect(
      shows({ values: { title: { en: null, fr: null, ar: null } } })
    ).toEqual([null]);
    expect(shows({ rules: { ...RULES, fallback: false } })).toEqual([null]);
  });

  it("never fills a unique field from another language", () => {
    expect(shows({ rows: [row("title", { unique: true })] })).toEqual([null]);
    expect(shows({ rows: [row("title", { unique: false })] })).toEqual(["fr"]);
  });

  it("doesn't guess a language whose standing can't be known", () => {
    expect(shows({ translations: undefined })).toEqual([undefined]);
    expect(
      shows({
        translations: undefined,
        values: { title: { en: null, fr: null, ar: null } },
      })
    ).toEqual([null]);
  });

  it("doesn't take a language the reader may not read for an empty one", () => {
    // French is left out of the values, and of the overview.
    const translations = { en: PUBLISHED, ar: { translated: false } };
    for (const en of ["Hello", null]) {
      expect(
        shows({ translations, values: { title: { en, ar: null } } })
      ).toEqual([undefined]);
    }
  });
});
