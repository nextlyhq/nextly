// The text inside a repeater's or group's rows, in the editor (`container-text`).
//
// A repeater or group keeps one structure in every language, so copying from another language
// copies the text inside onto the rows this language already has, by row id. The broken copies
// these separate: rows matched by position (a reorder hands one row's text to another), the
// source's rows copied whole (its order and shared values replacing this language's), and an
// empty source text blanking a translation.

import { describe, expect, it } from "vitest";

import { holdsTranslatedText, withTextFrom } from "../container-text";

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
