/**
 * Which translations a publish leaves out of date: after it (the notice), and before it (the
 * choice of what goes live), read from the translation overview.
 *
 * The plausible broken versions: counting every out-of-date field, including those already out of
 * date before the publish or made from a language that was not published; counting a field the
 * server cannot judge (`outOfDate` absent) as out of date; dropping a language whose values have
 * no recorded origin although it turned stale; forecasting a field already out of date; and a
 * link that opens the editor in the language just published rather than the one to translate.
 */
import { describe, expect, it } from "vitest";

import {
  newlyOutOfDate,
  outOfDateForecast,
  outOfDateNotice,
  predictOutOfDate,
  translateAddress,
  type TranslationOverview,
} from "../out-of-date";

const LANGUAGES = ["en", "es", "fr", "ar"];
const labelOf = (code: string) =>
  ({ en: "English", es: "Spanish", fr: "French", ar: "Arabic" })[code] ?? code;

const fromEnglish = (outOfDate?: boolean) => ({
  origin: "person",
  sourceLocale: "en",
  ...(outOfDate === undefined ? {} : { outOfDate }),
});

describe("the fields a publish left out of date", () => {
  it("counts the fields made from the published language that turned out of date", () => {
    const before: TranslationOverview = {
      es: { fields: { title: fromEnglish(false), body: fromEnglish(false) } },
    };
    const after: TranslationOverview = {
      es: { fields: { title: fromEnglish(true), body: fromEnglish(false) } },
    };
    expect(
      newlyOutOfDate({ languages: LANGUAGES, published: ["en"], before, after })
    ).toEqual([{ locale: "es", fields: 1 }]);
  });

  it("leaves out a field already out of date before the publish", () => {
    const before: TranslationOverview = {
      es: { fields: { title: fromEnglish(true), body: fromEnglish(false) } },
    };
    const after: TranslationOverview = {
      es: { fields: { title: fromEnglish(true), body: fromEnglish(true) } },
    };
    expect(
      newlyOutOfDate({ languages: LANGUAGES, published: ["en"], before, after })
    ).toEqual([{ locale: "es", fields: 1 }]);
  });

  it("leaves out a field made from a language that was not published", () => {
    const after: TranslationOverview = {
      fr: {
        fields: {
          title: { origin: "person", sourceLocale: "es", outOfDate: true },
        },
      },
    };
    expect(
      newlyOutOfDate({
        languages: LANGUAGES,
        published: ["en"],
        before: { fr: { fields: {} } },
        after,
      })
    ).toEqual([]);
  });

  it("does not count a field the server cannot judge", () => {
    const after: TranslationOverview = {
      es: { fields: { title: fromEnglish(undefined) } },
    };
    expect(
      newlyOutOfDate({
        languages: LANGUAGES,
        published: ["en"],
        before: undefined,
        after,
      })
    ).toEqual([]);
  });

  it("names a language with no recorded origins that turned stale, without a count", () => {
    expect(
      newlyOutOfDate({
        languages: LANGUAGES,
        published: ["en"],
        before: { ar: { stale: false } },
        after: { ar: { stale: true } },
      })
    ).toEqual([{ locale: "ar", fields: null }]);
    expect(
      newlyOutOfDate({
        languages: LANGUAGES,
        published: ["en"],
        before: { ar: { stale: true } },
        after: { ar: { stale: true } },
      })
    ).toEqual([]);
  });

  it("lists languages in the site's order", () => {
    const after: TranslationOverview = {
      fr: { fields: { title: fromEnglish(true) } },
      es: { fields: { title: fromEnglish(true), body: fromEnglish(true) } },
    };
    expect(
      newlyOutOfDate({
        languages: LANGUAGES,
        published: ["en"],
        before: undefined,
        after,
      })
    ).toEqual([
      { locale: "es", fields: 2 },
      { locale: "fr", fields: 1 },
    ]);
  });
});

describe("the fields a publish would leave out of date", () => {
  const overview: TranslationOverview = {
    es: {
      fields: {
        title: fromEnglish(false),
        body: fromEnglish(true),
        summary: fromEnglish(false),
      },
    },
    fr: {
      fields: {
        title: { origin: "person", sourceLocale: "es", outOfDate: false },
      },
    },
  };

  it("counts the fields made from an edited field of a published language, not already out of date", () => {
    expect(
      predictOutOfDate({
        languages: LANGUAGES,
        overview,
        edited: new Map([["en", new Set(["title", "body"])]]),
      })
    ).toEqual([{ locale: "es", fields: 1 }]);
  });

  it("counts a translation made from another translation when that one is published", () => {
    expect(
      predictOutOfDate({
        languages: LANGUAGES,
        overview,
        edited: new Map([["es", new Set(["title"])]]),
      })
    ).toEqual([{ locale: "fr", fields: 1 }]);
  });

  it("forecasts nothing when the publish edits no field a translation was made from", () => {
    expect(
      predictOutOfDate({
        languages: LANGUAGES,
        overview,
        edited: new Map([["en", new Set(["slug"])]]),
      })
    ).toEqual([]);
    expect(outOfDateForecast([], labelOf)).toBeNull();
  });

  it("says it as one line", () => {
    expect(
      outOfDateForecast(
        [
          { locale: "es", fields: 2 },
          { locale: "fr", fields: 1 },
        ],
        labelOf
      )
    ).toBe(
      "After this, 2 Spanish fields and 1 French field will be out of date."
    );
  });
});

describe("the notice after a publish", () => {
  it("names each language and its count, and links to translating it from the language published", () => {
    expect(
      outOfDateNotice({
        counts: [
          { locale: "es", fields: 2 },
          { locale: "ar", fields: null },
        ],
        labelOf,
        editorPath: "/admin/collections/posts/7",
        source: "en",
      })
    ).toEqual({
      text: "Published. 2 Spanish fields and the Arabic translation are now out of date.",
      languages: [
        {
          locale: "es",
          label: "Spanish",
          href: "/admin/collections/posts/7?locale=es&translate=en",
        },
        {
          locale: "ar",
          label: "Arabic",
          href: "/admin/collections/posts/7?locale=ar&translate=en",
        },
      ],
    });
  });

  it("reads as one thing for one field", () => {
    expect(
      outOfDateNotice({
        counts: [{ locale: "es", fields: 1 }],
        labelOf,
        editorPath: "/p",
        source: "en",
      })?.text
    ).toBe("Published. 1 Spanish field is now out of date.");
    expect(
      outOfDateNotice({
        counts: [{ locale: "ar", fields: null }],
        labelOf,
        editorPath: "/p",
        source: "en",
      })?.text
    ).toBe("Published. The Arabic translation is now out of date.");
  });

  it("says nothing when nothing went out of date", () => {
    expect(
      outOfDateNotice({ counts: [], labelOf, editorPath: "/p", source: "en" })
    ).toBeNull();
  });

  it("builds the address with the language to translate and its source", () => {
    expect(translateAddress("/admin/singles/home", "es", "en")).toBe(
      "/admin/singles/home?locale=es&translate=en"
    );
  });
});
