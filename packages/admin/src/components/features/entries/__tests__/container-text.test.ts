// The text inside a repeater's or group's rows, in the editor (`container-text`).
//
// A repeater or group keeps one structure in every language, so copying from another language
// copies the text inside onto the rows this language already has, by row id. The broken copies
// these separate: rows matched by position (a reorder hands one row's text to another), the
// source's rows copied whole (its order and shared values replacing this language's), and an
// empty source text blanking a translation.

import { describe, expect, it } from "vitest";

import {
  holdsTranslatedText,
  sourceValueAt,
  withTextFrom,
} from "../container-text";

const SLIDES = {
  type: "repeater",
  name: "slides",
  fields: [
    { type: "text", name: "caption" },
    { type: "number", name: "rank" },
    {
      type: "repeater",
      name: "items",
      fields: [{ type: "text", name: "label" }],
    },
  ],
};

describe("holdsTranslatedText", () => {
  it("names a repeater or group holding text inside, at any depth", () => {
    expect(holdsTranslatedText(SLIDES, true)).toBe(true);
    expect(
      holdsTranslatedText(
        {
          type: "group",
          name: "outer",
          fields: [{ type: "repeater", name: "inner", fields: SLIDES.fields }],
        },
        true
      )
    ).toBe(true);
  });

  it("does not name a container of shared values only, nor a document that is not translated, nor a plain field", () => {
    expect(
      holdsTranslatedText(
        {
          type: "group",
          name: "stats",
          fields: [{ type: "number", name: "views" }],
        },
        true
      )
    ).toBe(false);
    expect(holdsTranslatedText(SLIDES, false)).toBe(false);
    expect(holdsTranslatedText({ type: "text", name: "title" }, true)).toBe(
      false
    );
  });
});

describe("withTextFrom", () => {
  it("lays each row's text from the source row with the same id, keeping this language's rows, order and shared values", () => {
    const current = [
      { id: "r2", caption: "segundo", rank: 20, items: [] },
      { id: "r1", caption: "", rank: 10, items: [{ id: "i1", label: "" }] },
    ];
    // The source holds the rows in another order, with shared values of its own.
    const source = [
      {
        id: "r1",
        caption: "first",
        rank: 1,
        items: [{ id: "i1", label: "apple" }],
      },
      { id: "r2", caption: "second", rank: 2, items: [] },
    ];

    expect(withTextFrom(current, source, SLIDES, true)).toEqual([
      { id: "r2", caption: "second", rank: 20, items: [] },
      {
        id: "r1",
        caption: "first",
        rank: 10,
        items: [{ id: "i1", label: "apple" }],
      },
    ]);
  });

  it("keeps a row's own text where the source has no such row, or holds nothing there", () => {
    const current = [
      { id: "r1", caption: "primero", rank: 1, items: [] },
      { id: "r3", caption: "tercero", rank: 3, items: [] },
    ];
    const source = [{ id: "r1", caption: "  ", rank: 1, items: [] }];

    expect(withTextFrom(current, source, SLIDES, true)).toEqual(current);
  });

  it("lays a group's text from the source, keeping its shared values", () => {
    const seo = {
      type: "group",
      name: "seo",
      fields: [
        { type: "text", name: "headline" },
        { type: "number", name: "weight" },
      ],
    };
    expect(
      withTextFrom(
        { headline: "", weight: 9 },
        { headline: "Read me", weight: 5 },
        seo,
        true
      )
    ).toEqual({ headline: "Read me", weight: 9 });
  });
});

// A component placed in a container's rows holds its values inline in the row, its text translated
// with the row: the API hands its fields with it (`componentFields`).
describe("a component inside a container's rows", () => {
  const PANELS = {
    type: "repeater",
    name: "panels",
    fields: [
      { type: "number", name: "position" },
      {
        type: "component",
        name: "cards",
        repeatable: true,
        componentFields: [
          { type: "text", name: "label" },
          { type: "number", name: "size" },
        ],
      },
    ],
  };

  it("names the container as holding translated text", () => {
    expect(holdsTranslatedText(PANELS, true)).toBe(true);
  });

  it("lays each instance's text from the source instance with the same id", () => {
    const current = [
      {
        id: "p1",
        position: 1,
        cards: [
          { id: "c2", label: "", size: 20 },
          { id: "c1", label: "", size: 10 },
        ],
      },
    ];
    const source = [
      {
        id: "p1",
        position: 9,
        cards: [
          { id: "c1", label: "one", size: 1 },
          { id: "c2", label: "two", size: 2 },
        ],
      },
    ];

    expect(withTextFrom(current, source, PANELS, true)).toEqual([
      {
        id: "p1",
        position: 1,
        cards: [
          { id: "c2", label: "two", size: 20 },
          { id: "c1", label: "one", size: 10 },
        ],
      },
    ]);
  });

  // A single component offering several types: its text comes only from the same instance.
  const SLOTS = {
    type: "group",
    name: "slot",
    fields: [
      {
        type: "component",
        name: "lead",
        componentSchemas: {
          hero: { fields: [{ type: "text", name: "title" }] },
          cta: { fields: [{ type: "text", name: "title" }] },
        },
      },
    ],
  };

  it("copies a single instance's text only from the source instance of the same type", () => {
    const source = { lead: { _componentType: "hero", title: "Hello" } };

    // Changed to another component here: nothing of the source's hero lands in it.
    expect(
      withTextFrom(
        { lead: { _componentType: "cta", title: "" } },
        source,
        SLOTS,
        true
      )
    ).toEqual({ lead: { _componentType: "cta", title: "" } });
    // The same component: its text is copied.
    expect(
      withTextFrom(
        { lead: { _componentType: "hero", title: "" } },
        source,
        SLOTS,
        true
      )
    ).toEqual({ lead: { _componentType: "hero", title: "Hello" } });
  });
});

describe("sourceValueAt", () => {
  const source = {
    slides: [
      { id: "a", caption: "first" },
      { id: "b", caption: "second" },
    ],
    plain: [{ caption: "only" }],
  };

  it("reads a row on the path by its id, wherever the form has moved it", () => {
    const target = { slides: [{ id: "b" }, { id: "a" }] };
    expect(sourceValueAt(source, target, "slides.0.caption")).toBe("second");
    expect(sourceValueAt(source, target, "slides.1.caption")).toBe("first");
  });

  // A row with no unique id keeps its text shared in storage: it has no source text of its own,
  // and filling it would write the source's text into every language.
  it("reads no source text for a row with no unique id, nor where the source holds no list there", () => {
    expect(
      sourceValueAt(source, { plain: [{ caption: "" }] }, "plain.0.caption")
    ).toBeUndefined();
    expect(
      sourceValueAt(
        {
          lines: [
            { id: 7, caption: "seven" },
            { id: 7, caption: "again" },
          ],
        },
        { lines: [{ id: 7 }, { id: 7 }] },
        "lines.1.caption"
      )
    ).toBeUndefined();
    // A numeric id, unique in its list, is a key as storage takes it.
    expect(
      sourceValueAt(
        { lines: [{ id: 7, caption: "seven" }] },
        { lines: [{ id: 7 }] },
        "lines.0.caption"
      )
    ).toBe("seven");
    expect(
      sourceValueAt(
        { slides: "none" },
        { slides: [{ id: "a" }] },
        "slides.0.caption"
      )
    ).toBeUndefined();
    // A row the source does not hold has no source text.
    expect(
      sourceValueAt(source, { slides: [{ id: "new" }] }, "slides.0.caption")
    ).toBeUndefined();
  });
});

describe("withTextFrom, field by field", () => {
  const CARD = {
    type: "group",
    name: "card",
    fields: [
      { type: "text", name: "title" },
      { type: "number", name: "size" },
      { type: "text", name: "code", localized: false },
    ],
  };

  it("takes a translated value from the source, and keeps every other field's own", () => {
    expect(
      withTextFrom(
        { title: "", size: 1, code: "x" },
        { title: "Hello", size: 9, code: "y" },
        CARD,
        true
      )
    ).toEqual({ title: "Hello", size: 1, code: "x" });
  });
});

describe("a container saying it is not translated", () => {
  const SHARED = {
    type: "group",
    name: "settings",
    localized: false,
    fields: [{ type: "text", name: "visibility" }],
  };

  // Storage keeps it whole, the same in every language: no badge, nothing to copy.
  it("holds no translated text and takes none from another language", () => {
    expect(holdsTranslatedText(SHARED, true)).toBe(false);
    expect(
      withTextFrom({ visibility: "" }, { visibility: "private" }, SHARED, true)
    ).toEqual({ visibility: "" });
    const PAGE = {
      type: "group",
      name: "page",
      fields: [{ type: "text", name: "heading" }, SHARED],
    };
    expect(
      withTextFrom(
        { heading: "", settings: { visibility: "" } },
        { heading: "Hello", settings: { visibility: "private" } },
        PAGE,
        true
      )
    ).toEqual({ heading: "Hello", settings: { visibility: "" } });
  });
});
