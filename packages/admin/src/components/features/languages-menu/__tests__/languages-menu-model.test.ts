/**
 * What the Languages menu says: each language's one line, its state, and the count of languages
 * that need work, each reached by exactly the facts that should reach it.
 *
 * Catches a model that counts a language once for every reason it needs work, counts the default
 * language or one never started, calls a language live because its own status says published
 * while nobody is shown it, or marks "Spanish" up as if it were written in Spanish.
 */
import { describe, expect, it } from "vitest";

import {
  languagesMenuModel,
  needWorkWords,
  type LanguageOverview,
  type LanguageRow,
  type LanguagesMenuModel,
  type MenuLanguage,
} from "../languages-menu-model";

type ModelArgs = Parameters<typeof languagesMenuModel>[0];

const ENGLISH: MenuLanguage = { code: "en", label: "English", rtl: false };
const SPANISH: MenuLanguage = { code: "es", label: "Spanish", rtl: false };
const FRENCH: MenuLanguage = { code: "fr", label: "French", rtl: false };
const GERMAN: MenuLanguage = { code: "de", label: "German", rtl: false };
const ARABIC: MenuLanguage = { code: "ar", label: "Arabic", rtl: true };

const LIVE: LanguageOverview = { translated: true, status: "published" };
const DRAFT: LanguageOverview = { translated: true, status: "draft" };
const ONE_FIELD = { title: { outOfDate: true }, body: { outOfDate: false } };
const TWO_FIELDS = { title: { outOfDate: true }, body: { outOfDate: true } };

/** The model where there must be one: English (the default) and Spanish unless told otherwise. */
function modelOf(args: Partial<ModelArgs>): LanguagesMenuModel {
  const model = languagesMenuModel({
    languages: [ENGLISH, SPANISH],
    defaultLanguage: "en",
    translations: { en: LIVE },
    ...args,
  });
  if (model === null) throw new Error("expected a model");
  return model;
}

function rowOf(model: LanguagesMenuModel, code: string): LanguageRow {
  const row = model.rows.find(each => each.code === code);
  if (row === undefined) throw new Error(`expected a row for ${code}`);
  return row;
}

/** What the model says of one language, and the count it arrives at. */
function saidOf(model: LanguagesMenuModel, code: string) {
  const { status, state, needsWork } = rowOf(model, code);
  return { status, state, needsWork, needWork: model.needWork };
}

/** What the model says of Spanish, the only translation, from its part of the overview. */
function spanish(
  overview: LanguageOverview | undefined,
  documentStatus?: unknown
) {
  return saidOf(
    modelOf({
      translations:
        overview === undefined ? { en: LIVE } : { en: LIVE, es: overview },
      documentStatus,
    }),
    "es"
  );
}

/** What the model says of English, the default, from its part of the overview. */
function english(
  overview: LanguageOverview | undefined,
  documentStatus?: unknown
) {
  return saidOf(
    modelOf({
      translations: overview === undefined ? {} : { en: overview },
      documentStatus,
    }),
    "en"
  );
}

describe("a translation's status", () => {
  it.each<{ name: string; overview: LanguageOverview | undefined }>([
    { name: "absent from the overview", overview: undefined },
    { name: "in it and not translated", overview: { translated: false } },
    {
      name: "not translated, whatever its status and origin say",
      overview: {
        translated: false,
        status: "published",
        stale: true,
        fields: ONE_FIELD,
      },
    },
  ])("is not started when it is $name", ({ overview }) => {
    expect(spanish(overview)).toEqual({
      status: "not started",
      state: "missing",
      needsWork: false,
      needWork: 0,
    });
  });

  it("is live once published with nothing waiting", () => {
    expect(spanish(LIVE)).toEqual({
      status: "live",
      state: "live",
      needsWork: false,
      needWork: 0,
    });
  });

  it.each<{ name: string; overview: LanguageOverview; status: string }>([
    {
      name: "one field",
      overview: { ...LIVE, stale: true, fields: ONE_FIELD },
      status: "live, 1 field out of date",
    },
    {
      name: "several fields",
      overview: { ...LIVE, stale: true, fields: TWO_FIELDS },
      status: "live, 2 fields out of date",
    },
    {
      name: "the whole of it, where no field's origin is recorded",
      overview: { ...LIVE, stale: true },
      status: "live, out of date",
    },
    {
      name: "the whole of it, where fields are recorded and none is marked",
      overview: {
        ...LIVE,
        stale: true,
        fields: { title: { outOfDate: false }, body: {} },
      },
      status: "live, out of date",
    },
    {
      name: "a field marked where the language itself is not",
      overview: { ...LIVE, fields: ONE_FIELD },
      status: "live, 1 field out of date",
    },
    {
      name: "fields marked where the language is said to be up to date",
      overview: { ...LIVE, stale: false, fields: TWO_FIELDS },
      status: "live, 2 fields out of date",
    },
  ])("says what is out of date: $name", ({ overview, status }) => {
    expect(spanish(overview)).toEqual({
      status,
      state: "outOfDate",
      needsWork: true,
      needWork: 1,
    });
  });

  it("is not out of date when its recorded fields are all current", () => {
    expect(
      spanish({ ...LIVE, fields: { title: { outOfDate: false }, body: {} } })
    ).toEqual({
      status: "live",
      state: "live",
      needsWork: false,
      needWork: 0,
    });
  });

  it("says a live one's changes are not published", () => {
    expect(spanish({ ...LIVE, pendingChange: true })).toEqual({
      status: "live, changes not published",
      state: "changes",
      needsWork: true,
      needWork: 1,
    });
  });

  it("says what is out of date first, and only that, when it holds a change too", () => {
    const both = { ...LIVE, stale: true, fields: ONE_FIELD };
    expect(spanish({ ...both, pendingChange: true })).toEqual({
      status: "live, 1 field out of date",
      state: "outOfDate",
      needsWork: true,
      needWork: 1,
    });
    // The row still tells the two apart, whichever its line says.
    const factsOf = (es: LanguageOverview) => {
      const { outOfDate, pendingChange } = rowOf(
        modelOf({ translations: { en: LIVE, es } }),
        "es"
      );
      return { outOfDate, pendingChange };
    };
    expect(factsOf({ ...both, pendingChange: true })).toEqual({
      outOfDate: true,
      pendingChange: true,
    });
    expect(factsOf(both)).toEqual({ outOfDate: true, pendingChange: false });
    expect(factsOf({ ...LIVE, pendingChange: true })).toEqual({
      outOfDate: false,
      pendingChange: true,
    });
    expect(factsOf(LIVE)).toEqual({ outOfDate: false, pendingChange: false });
  });

  it("is a draft, which asks for no work by itself", () => {
    expect(spanish(DRAFT)).toEqual({
      status: "draft",
      state: "draft",
      needsWork: false,
      needWork: 0,
    });
  });

  it("is a draft that is out of date", () => {
    expect(spanish({ ...DRAFT, stale: true, fields: ONE_FIELD })).toEqual({
      status: "draft, 1 field out of date",
      state: "outOfDate",
      needsWork: true,
      needWork: 1,
    });
  });

  it("is a draft that holds a change", () => {
    expect(spanish({ ...DRAFT, pendingChange: true })).toEqual({
      status: "draft, changes not published",
      state: "draft",
      needsWork: true,
      needWork: 1,
    });
  });

  it.each<{ name: string; overview: LanguageOverview }>([
    {
      name: "with no status",
      overview: { translated: false, pendingChange: true },
    },
    {
      name: "with a status that says published",
      overview: { translated: false, status: "published", pendingChange: true },
    },
    {
      // There is no text of its own yet that could have fallen behind.
      name: "given an origin that moved",
      overview: {
        translated: false,
        status: "published",
        pendingChange: true,
        stale: true,
        fields: ONE_FIELD,
      },
    },
  ])(
    "is a started draft, never live, while its first content is held: $name",
    ({ overview }) => {
      const held = {
        status: "draft, changes not published",
        state: "draft",
        needsWork: true,
        needWork: 1,
      };
      expect(spanish(overview)).toEqual(held);
      // Nor is it put in front of readers by what it belongs to being published.
      expect(spanish(overview, "published")).toEqual(held);
    }
  );

  it("is live once written, where nothing has a status", () => {
    expect(spanish({ translated: true })).toEqual({
      status: "live",
      state: "live",
      needsWork: false,
      needWork: 0,
    });
  });

  it("is a draft in whatever is itself a draft, even when published", () => {
    expect(spanish(LIVE, "draft")).toEqual({
      status: "draft",
      state: "draft",
      needsWork: false,
      needWork: 0,
    });
    // With that published, the same language is live, and a draft one still is not.
    expect(spanish(LIVE, "published").status).toBe("live");
    expect(spanish(DRAFT, "published").status).toBe("draft");
  });
});

describe("the default language's status", () => {
  it("is written even when absent from the overview", () => {
    expect(english(undefined)).toEqual({
      status: "live",
      state: "live",
      needsWork: false,
      needWork: 0,
    });
    expect(english(undefined, "draft")).toEqual({
      status: "draft",
      state: "draft",
      needsWork: false,
      needWork: 0,
    });
    // Any other language absent from it has nothing.
    expect(saidOf(modelOf({ translations: {} }), "es").status).toBe(
      "not started"
    );
  });

  it("is written even when the overview says it is not translated", () => {
    expect(english({ translated: false, status: "published" }).status).toBe(
      "live"
    );
    expect(english({ translated: false, status: "draft" }).status).toBe(
      "draft"
    );
  });

  it("is never out of date, though the overview marks it", () => {
    const marked = { ...LIVE, stale: true, fields: TWO_FIELDS };
    expect(english(marked)).toEqual({
      status: "live",
      state: "live",
      needsWork: false,
      needWork: 0,
    });
    // The same marks on a translation do count.
    expect(spanish(marked).status).toBe("live, 2 fields out of date");
  });

  it("says its changes are not published, and is still not counted", () => {
    expect(english({ ...LIVE, pendingChange: true })).toEqual({
      status: "live, changes not published",
      state: "changes",
      needsWork: false,
      needWork: 0,
    });
  });

  it("is that of the one the site names, and of no other row", () => {
    const model = modelOf({ defaultLanguage: "es", translations: {} });
    expect(
      model.rows.map(row => [row.code, row.isDefault, row.status])
    ).toEqual([
      ["en", false, "not started"],
      ["es", true, "live"],
    ]);
  });
});

describe("the count", () => {
  it("counts each language that needs work once, and nothing else", () => {
    const model = modelOf({
      languages: [ENGLISH, SPANISH, FRENCH, GERMAN, ARABIC],
      translations: {
        // The default, holding a change.
        en: { ...LIVE, pendingChange: true },
        // Two reasons, one language.
        es: { ...LIVE, stale: true, fields: TWO_FIELDS, pendingChange: true },
        fr: { ...LIVE, pendingChange: true },
        de: DRAFT,
        // Arabic is not started.
      },
    });
    expect(model.rows.map(row => [row.code, row.needsWork])).toEqual([
      ["en", false],
      ["es", true],
      ["fr", true],
      ["de", false],
      ["ar", false],
    ]);
    expect(model.needWork).toBe(2);
  });

  it("counts every translation when every one needs work", () => {
    const model = modelOf({
      languages: [ENGLISH, SPANISH, FRENCH, ARABIC],
      translations: {
        en: LIVE,
        es: { ...LIVE, stale: true },
        fr: { ...DRAFT, pendingChange: true },
        ar: { translated: false, pendingChange: true },
      },
    });
    expect(model.needWork).toBe(3);
  });
});

describe("when there is a menu", () => {
  it("has none for a site with no language, or with one", () => {
    const modelFor = (languages: MenuLanguage[]) =>
      languagesMenuModel({
        languages,
        defaultLanguage: "en",
        translations: { en: LIVE },
      });
    expect(modelFor([])).toBeNull();
    expect(modelFor([ENGLISH])).toBeNull();
    expect(modelFor([ENGLISH, SPANISH])).not.toBeNull();
  });

  it("says nothing of any language where the overview was not read, and reads an empty one", () => {
    const modelFor = (translations: ModelArgs["translations"]) =>
      languagesMenuModel({
        languages: [ENGLISH, SPANISH],
        defaultLanguage: "en",
        translations,
      });
    const unread = modelFor(undefined);
    // Every language, with no state claimed for any, and none to count.
    expect(
      unread?.rows.map(({ code, status, state, needsWork }) => ({
        code,
        status,
        state,
        needsWork,
      }))
    ).toEqual([
      { code: "en", status: null, state: null, needsWork: false },
      { code: "es", status: null, state: null, needsWork: false },
    ]);
    expect(unread?.needWork).toBe(0);
    const empty = modelFor({});
    expect(empty?.rows.map(row => row.status)).toEqual(["live", "not started"]);
    expect(empty?.needWork).toBe(0);
  });
});

describe("the rows", () => {
  it("are the site's languages in its order, wherever the default stands", () => {
    const model = modelOf({
      languages: [ARABIC, ENGLISH, SPANISH],
      // In another order than the site's.
      translations: { es: LIVE, en: LIVE, ar: LIVE },
    });
    expect(model.rows.map(row => row.code)).toEqual(["ar", "en", "es"]);
  });

  it("leave out a language the site no longer has, and do not count it", () => {
    const translations = {
      en: LIVE,
      es: LIVE,
      fr: { ...LIVE, stale: true, pendingChange: true },
    };
    const model = modelOf({ translations });
    expect(model.rows.map(row => row.code)).toEqual(["en", "es"]);
    expect(model.needWork).toBe(0);
    // Back on the site, the same overview gives it a row and counts it.
    const restored = modelOf({
      languages: [ENGLISH, SPANISH, FRENCH],
      translations,
    });
    expect(restored.rows.map(row => row.code)).toEqual(["en", "es", "fr"]);
    expect(restored.needWork).toBe(1);
  });

  it("carry the code in a name two languages share, and only there", () => {
    const model = modelOf({
      languages: [
        ENGLISH,
        { code: "en-GB", label: "English", rtl: false },
        SPANISH,
      ],
    });
    expect(model.rows.map(row => row.name)).toEqual([
      "English (en)",
      "English (en-GB)",
      "Spanish",
    ]);
  });
});

describe("how a name is marked up", () => {
  /** The markup of one language's name, English standing beside it. */
  function attributesOf(language: MenuLanguage): LanguageRow["nameAttributes"] {
    return rowOf(modelOf({ languages: [ENGLISH, language] }), language.code)
      .nameAttributes;
  }

  it("is in its own language and direction where it is written in it", () => {
    expect(attributesOf({ code: "es", label: "Español", rtl: false })).toEqual({
      lang: "es",
      dir: "ltr",
    });
    expect(attributesOf({ code: "ar", label: "العربية", rtl: true })).toEqual({
      lang: "ar",
      dir: "rtl",
    });
  });

  it("is only given its letters' direction where it is written in another", () => {
    // Right to left is how Arabic is written, not how the word "Arabic" is.
    expect(attributesOf(SPANISH)).toStrictEqual({ dir: "auto" });
    expect(attributesOf(ARABIC)).toStrictEqual({ dir: "auto" });
  });

  it.each(["español", "ESPAÑOL", " Español "])(
    "knows %j as Spanish's own name, whatever its letters' case",
    label => {
      expect(attributesOf({ code: "es", label, rtl: false })).toEqual({
        lang: "es",
        dir: "ltr",
      });
    }
  );

  it("knows a regional language by its language's own name", () => {
    expect(
      attributesOf({ code: "es-MX", label: "Español", rtl: false })
    ).toEqual({ lang: "es-MX", dir: "ltr" });
    expect(
      attributesOf({ code: "es-MX", label: "Spanish", rtl: false })
    ).toStrictEqual({ dir: "auto" });
  });

  it("does not take a code no language has for the language's own name", () => {
    // Nothing names it, so its code stands in for its name.
    expect(attributesOf({ code: "xx", label: "Xx", rtl: false })).toStrictEqual(
      { dir: "auto" }
    );
  });

  it.each(["en_US", "not a code"])(
    "survives %j, a code it cannot read",
    code => {
      const model = modelOf({
        languages: [ENGLISH, { code, label: "American", rtl: false }],
        translations: { en: LIVE, [code]: LIVE },
      });
      expect(rowOf(model, code)).toStrictEqual({
        code,
        name: "American",
        nameAttributes: { dir: "auto" },
        isDefault: false,
        state: "live",
        status: "live",
        outOfDate: false,
        pendingChange: false,
        needsWork: false,
      });
      // Labelled with its own code, it still names nothing.
      expect(attributesOf({ code, label: code, rtl: false })).toStrictEqual({
        dir: "auto",
      });
    }
  );
});

describe("needWorkWords", () => {
  it("agrees with its number", () => {
    expect(needWorkWords(1)).toBe("1 needs attention");
    expect(needWorkWords(2)).toBe("2 need attention");
    expect(needWorkWords(12)).toBe("12 need attention");
  });
});
