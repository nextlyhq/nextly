/**
 * A language is a source for a field when its own value for it is published
 * and not out of date. Each case that refuses a language keeps another that
 * stays eligible, so a rule refusing everything fails.
 */
import { describe, expect, it } from "vitest";

import {
  eligibleSources,
  shownSource,
  type SourceFacts,
} from "../source-eligibility";

const PUBLISHED = { translated: true, status: "published" };

const FACTS: SourceFacts = {
  locales: [{ code: "en" }, { code: "es" }, { code: "fr" }, { code: "ar" }],
  defaultLocale: "en",
  target: "ar",
  values: { title: { en: "Hello", es: "Hola", fr: "Bonjour", ar: "مرحبا" } },
  translations: { en: PUBLISHED, es: PUBLISHED, fr: PUBLISHED, ar: PUBLISHED },
  hasStatus: true,
  status: "published",
};

const sources = (over: Partial<SourceFacts> = {}) =>
  eligibleSources("title", { ...FACTS, ...over });

const withMeta = (code: string, meta: Record<string, unknown>) => ({
  translations: {
    ...FACTS.translations,
    [code]: { translated: true, ...meta },
  },
});

describe("eligibleSources", () => {
  it("offers every other published language, in the site's order", () => {
    expect(sources()).toEqual(["en", "es", "fr"]);
  });

  it("never offers the language being written", () => {
    expect(sources({ target: "es" })).toEqual(["en", "fr", "ar"]);
  });

  it("refuses a language in draft", () => {
    expect(sources(withMeta("es", { status: "draft" }))).toEqual(["en", "fr"]);
  });

  it("keeps a published language with unpublished changes: its live text is the source", () => {
    expect(
      sources(withMeta("es", { status: "published", pendingChange: true }))
    ).toEqual(["en", "es", "fr"]);
  });

  it("refuses every language of a document that is not itself published", () => {
    expect(sources({ status: "draft" })).toEqual([]);
  });

  it("refuses a language whose value for this field is out of date", () => {
    expect(
      sources(
        withMeta("es", {
          status: "published",
          fields: { title: { origin: "person", outOfDate: true } },
        })
      )
    ).toEqual(["en", "fr"]);
  });

  it("judges each field by its own record, not its language's", () => {
    // Another field is behind, which makes the language stale as a whole.
    expect(
      sources(
        withMeta("es", {
          status: "published",
          stale: true,
          fields: {
            title: { origin: "person", outOfDate: false },
            body: { origin: "person", outOfDate: true },
          },
        })
      )
    ).toEqual(["en", "es", "fr"]);
  });

  it("judges a value with no record by its language", () => {
    expect(
      sources(withMeta("es", { status: "published", stale: true }))
    ).toEqual(["en", "fr"]);
    expect(sources(withMeta("es", { status: "published" }))).toContain("es");
  });

  it("refuses a language with nothing in the field", () => {
    expect(
      sources({ values: { title: { en: "Hello", es: "  ", fr: null } } })
    ).toEqual(["en"]);
  });

  it("refuses a language the server withheld from the reader", () => {
    expect(sources({ values: { title: { en: "Hello" } } })).toEqual(["en"]);
  });

  it("offers nothing for a field with no values at all", () => {
    expect(eligibleSources("body", FACTS)).toEqual([]);
  });

  it("counts everything stored as published where there is no draft state", () => {
    expect(
      sources({
        hasStatus: false,
        status: undefined,
        translations: {
          en: { translated: true },
          es: { translated: true },
          fr: { translated: true },
        },
      })
    ).toEqual(["en", "es", "fr"]);
  });

  it("offers only the default language, by the document's status, where standings may not be read", () => {
    expect(sources({ translations: undefined })).toEqual(["en"]);
    expect(sources({ translations: undefined, status: "draft" })).toEqual([]);
  });
});

describe("shownSource", () => {
  it("is the one asked for, where the field can be translated from it", () => {
    expect(shownSource(["en", "es"], "es", "en")).toBe("es");
  });

  it("is the default language unless another was chosen", () => {
    expect(shownSource(["es", "en"], undefined, "en")).toBe("en");
    expect(shownSource(["es", "en"], "fr", "en")).toBe("en");
  });

  it("is the first there is where the default has nothing to offer", () => {
    expect(shownSource(["fr", "es"], undefined, "en")).toBe("fr");
  });

  it("is none where the field has none", () => {
    expect(shownSource([], "es", "en")).toBeUndefined();
  });
});
