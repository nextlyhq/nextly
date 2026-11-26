/**
 * What a translator is told of each text: only what was read as them, the source a translation may
 * be made from and no other, and the suggestion that is for that text.
 */
import { describe, expect, it } from "vitest";

import type { SharedStructureShape } from "../../shared-structure";
import {
  documentUnits,
  unitSourceRefusal,
  type ReadDocument,
  type UnitFacts,
  type UnitLanguages,
} from "../document-units";
import type { OpenSuggestion } from "../suggestion-store";
import { fieldUnit, unitKey, type UnitAddress } from "../unit-address";

const SECTIONS: SharedStructureShape = {
  kind: "repeater",
  texts: ["caption"],
  inner: {},
};
const CAPTION: UnitAddress = [
  { field: "sections" },
  { row: "r1" },
  { field: "caption" },
];

const languages: UnitLanguages = {
  configured: ["en", "fr", "es"],
  defaultLocale: "en",
  target: "es",
};

const upToDate = { origin: "person", outOfDate: false };

/** A live document with English and French published, read while writing Spanish. */
function read(over: Partial<ReadDocument> = {}): ReadDocument {
  return {
    fields: {
      names: ["title", "sections"],
      shapes: new Map([["sections", SECTIONS]]),
    },
    hasStatus: true,
    written: { title: "Hola", sections: [{ id: "r1", caption: "Uno" }] },
    live: {
      status: "published",
      _allLocales: {
        title: { en: "Hello", fr: "Bonjour", es: "Hola" },
        sections: {
          en: [{ id: "r1", caption: "One" }],
          fr: [{ id: "r1", caption: "Un" }],
        },
      },
      _translations: {
        en: { translated: true, status: "published" },
        fr: {
          translated: true,
          status: "published",
          fields: { title: upToDate, sections: upToDate },
        },
      },
    },
    ...over,
  };
}

const facts: UnitFacts = {
  editable: new Set([unitKey(fieldUnit("title"))]),
  suggestions: new Map(),
  fingerprintOf: (locale, _address, value) => `${locale}:${String(value)}`,
  settled: () => true,
};

const unitsOf = (document = read(), over: Partial<UnitFacts> = {}) =>
  documentUnits(document, languages, { ...facts, ...over });

/** A live document with one part of its standing replaced. */
function standing(
  over: Record<string, unknown>,
  live: Record<string, unknown> = {}
): ReadDocument {
  const base = read().live;
  return read({
    live: {
      ...base,
      ...live,
      _translations: { ...(base._translations as object), ...over },
    },
  });
}

describe("a document's units", () => {
  it("are its texts as they stand in the language, with the default language's beside each", () => {
    expect(unitsOf()).toEqual([
      {
        address: fieldUnit("title"),
        key: unitKey(fieldUnit("title")),
        path: "title",
        value: "Hola",
        canEdit: true,
        sources: [
          { locale: "en", value: "Hello", fingerprint: "en:Hello" },
          { locale: "fr", value: "Bonjour", fingerprint: "fr:Bonjour" },
        ],
        suggestion: null,
      },
      {
        address: CAPTION,
        key: unitKey(CAPTION),
        path: "sections#r1.caption",
        value: "Uno",
        canEdit: false,
        sources: [
          { locale: "en", value: "One", fingerprint: "en:One" },
          { locale: "fr", value: "Un", fingerprint: "fr:Un" },
        ],
        suggestion: null,
      },
    ]);
  });

  it("show each source where it qualifies", () => {
    const behind = standing({
      fr: {
        translated: true,
        status: "published",
        fields: { title: upToDate, sections: { outOfDate: true } },
      },
    });
    expect(
      unitsOf(behind).map(unit => unit.sources?.map(({ locale }) => locale))
    ).toEqual([["en", "fr"], ["en"]]);
  });

  it("say where the language's own text came from and whether it is old, where that is known", () => {
    const spanish = standing({
      es: {
        translated: true,
        status: "published",
        fields: { title: { origin: "machine", outOfDate: true } },
      },
    });
    const said = unitsOf(spanish).map(({ origin, outOfDate }) => ({
      origin,
      outOfDate,
    }));
    expect(said).toEqual([
      { origin: "machine", outOfDate: true },
      { origin: undefined, outOfDate: undefined },
    ]);
  });

  // Broken by telling what is recorded of a text beside another value of it, and by telling the
  // sources that are known as all there are.
  it("are told nothing recorded of a text saved as it was read, nor of its sources where one was", () => {
    const text = (unit: ReturnType<typeof unitsOf>[number]) => ({
      told: "origin" in unit || "outOfDate" in unit,
      sources: unit.sources?.map(source => source.locale),
    });
    const spanish = standing({
      es: {
        translated: true,
        status: "published",
        fields: { title: upToDate, sections: upToDate },
      },
    });
    const all = ["en", "fr"];
    /** The title saved in one language as it was read. */
    const savedIn = (language: string): Pick<UnitFacts, "settled"> => ({
      settled: (address, locale) =>
        unitKey(address) !== unitKey(fieldUnit("title")) ||
        (locale !== undefined && locale !== language),
    });
    expect(unitsOf(spanish, savedIn("fr")).map(text)).toEqual([
      { told: false, sources: undefined },
      { told: true, sources: all },
    ]);
    // Saved in the language it is written in, its sources are as they were read.
    expect(unitsOf(spanish, savedIn("es")).map(text)).toEqual([
      { told: false, sources: all },
      { told: true, sources: all },
    ]);
  });

  it("have no source where none qualifies, the first language written", () => {
    const alone = standing({}, { _allLocales: { title: {}, sections: {} } });
    expect(unitsOf(alone).map(({ sources }) => sources)).toEqual([[], []]);
  });

  it("read a text nothing holds yet as null", () => {
    const sections = [{ id: "r1", caption: null }];
    const empty = read({ written: { title: null, sections } });
    expect(unitsOf(empty).map(unit => unit.value)).toEqual([null, null]);
  });

  it("leave out a field the caller may not read in the language", () => {
    const hidden = read({ written: { title: "Hola" } });
    expect(unitsOf(hidden).map(unit => unit.key)).toEqual([
      unitKey(fieldUnit("title")),
    ]);
  });

  it("carry the suggestion that is for their own text", () => {
    const suggestion: OpenSuggestion = {
      id: "s1",
      document: { scopeKind: "collection", scopeSlug: "posts", entryId: "e1" },
      targetLocale: "es",
      address: CAPTION,
      value: "Primero",
      origin: "machine",
      engine: "stub",
      sourceLocale: "en",
      sourceFingerprint: "f",
      createdAt: new Date("2026-11-25T10:00:00Z"),
    };
    const suggestions = new Map([[unitKey(CAPTION), suggestion]]);
    expect(
      unitsOf(read(), { suggestions }).map(unit => unit.suggestion)
    ).toEqual([null, suggestion]);
  });
});

describe("a language as a unit's source", () => {
  const refusal = (document: ReadDocument, locale: string, at = CAPTION) =>
    unitSourceRefusal(document, languages, at, locale);

  it("is refused nothing where its text is published and up to date", () => {
    expect(refusal(read(), "en")).toBeNull();
    expect(refusal(read(), "fr")).toBeNull();
  });

  it("is told nothing of where its values were withheld", () => {
    const withheld = standing(
      {},
      {
        _allLocales: {
          title: { en: "Hello" },
          sections: { en: [{ id: "r1", caption: "One" }] },
        },
      }
    );
    expect(refusal(withheld, "fr")).toBe("not-readable");
    expect(refusal(withheld, "en")).toBeNull();
  });

  // Broken by reading a text left out of its row as one that was never written.
  it("is told nothing of where the one text was left out of its row", () => {
    const sections = { en: [{ id: "r1", caption: "One" }], fr: [{ id: "r1" }] };
    const withheld = standing({}, { _allLocales: { sections } });
    expect(refusal(withheld, "fr")).toBe("not-readable");
    expect(refusal(withheld, "en")).toBeNull();
  });

  it("is a draft where the document is, whatever the language says", () => {
    expect(refusal(standing({}, { status: "draft" }), "fr")).toBe(
      "not-published"
    );
  });

  it("is a draft where the language is, in a published document", () => {
    const draft = { translated: true, status: "draft", fields: {} };
    expect(refusal(standing({ fr: draft }), "fr")).toBe("not-published");
  });

  it("has the document's status where it has none of its own", () => {
    const none = { translated: true, fields: { sections: upToDate } };
    expect(refusal(standing({ fr: none }), "fr")).toBeNull();
  });

  it("is always shown in a document with no such status", () => {
    const plain = { ...standing({}, { status: undefined }), hasStatus: false };
    expect(refusal(plain, "fr")).toBeNull();
  });

  it("is the default language alone where no standing may be read", () => {
    const bare = read({ live: { ...read().live, _translations: undefined } });
    expect(refusal(bare, "en")).toBeNull();
    expect(refusal(bare, "fr")).toBe("not-published");
  });

  it("has no text of a row its live value lacks", () => {
    const gone: UnitAddress = [
      { field: "sections" },
      { row: "r2" },
      { field: "caption" },
    ];
    expect(refusal(read(), "fr", gone)).toBe("no-own-value");
  });

  it("is judged by the text's own record before its field's", () => {
    const fields = (text: boolean, whole: boolean) => ({
      fr: {
        translated: true,
        status: "published",
        fields: {
          sections: {
            outOfDate: whole,
            texts: { "sections#r1.caption": { outOfDate: text } },
          },
        },
      },
    });
    expect(refusal(standing(fields(false, true)), "fr")).toBeNull();
    expect(refusal(standing(fields(true, false)), "fr")).toBe("out-of-date");
  });

  it("is judged by its field's record where the text has none of its own", () => {
    const another = (outOfDate: boolean) => ({
      fr: {
        translated: true,
        status: "published",
        fields: {
          sections: {
            outOfDate,
            texts: { "sections#r2.caption": { outOfDate: !outOfDate } },
          },
        },
      },
    });
    expect(refusal(standing(another(false)), "fr")).toBeNull();
    expect(refusal(standing(another(true)), "fr")).toBe("out-of-date");
  });
});
