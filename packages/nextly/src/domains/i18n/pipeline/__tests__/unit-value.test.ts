/**
 * The text at an address is found by its row's id and replaced alone: a reorder moves neither the
 * answer nor the write, and a row that is gone is refused rather than given to its neighbour.
 */
import { describe, expect, it } from "vitest";

import type { UnitAddress } from "../unit-address";
import { unitValueIn, unitWithheld, withUnitValue } from "../unit-value";

const CAPTION: UnitAddress = [
  { field: "sections" },
  { row: "r2" },
  { field: "caption" },
];
const DEEP: UnitAddress = [
  { field: "sections" },
  { row: "r1" },
  { field: "points" },
  { row: "p2" },
  { field: "text" },
];

const first = {
  id: "r1",
  caption: "Uno",
  points: [
    { id: "p1", text: "a" },
    { id: "p2", text: "b" },
  ],
};
const second = { id: "r2", caption: "Dos", points: [] };
const document = {
  title: "Hola",
  empty: "",
  sections: [first, second],
  seo: { metaTitle: "Meta" },
  nothing: null,
};

describe("the text at an address", () => {
  it.each<[string, UnitAddress, unknown]>([
    ["a field's own", [{ field: "title" }], "Hola"],
    ["a blank one", [{ field: "empty" }], ""],
    ["a row's", CAPTION, "Dos"],
    ["one in a list inside a list", DEEP, "b"],
    ["a group's", [{ field: "seo" }, { field: "metaTitle" }], "Meta"],
  ])("is found: %s", (_what, address, value) => {
    expect(unitValueIn(document, address)).toEqual({ found: true, value });
  });

  it("is the same row's after the list is reordered", () => {
    const reordered = { ...document, sections: [second, first] };
    expect(unitValueIn(reordered, CAPTION)).toEqual({
      found: true,
      value: "Dos",
    });
  });

  it("is found in a list kept as JSON text", () => {
    const stored = { sections: JSON.stringify([first, second]) };
    expect(unitValueIn(stored, DEEP)).toEqual({ found: true, value: "b" });
  });

  it("is found by the text of a row's own number id", () => {
    const rows = { sections: [{ id: 7, caption: "Siete" }] };
    const address: UnitAddress = [
      { field: "sections" },
      { row: "7" },
      { field: "caption" },
    ];
    expect(unitValueIn(rows, address)).toEqual({ found: true, value: "Siete" });
  });

  it("is the first row's where two rows hold one id", () => {
    const rows = { sections: [second, { ...second, caption: "Otra" }] };
    expect(unitValueIn(rows, CAPTION)).toEqual({ found: true, value: "Dos" });
  });

  it.each<[string, Record<string, unknown>]>([
    ["the row is gone", { sections: [first] }],
    ["the list is empty", { sections: [] }],
    ["the list is not there", {}],
    ["the list is no list", { sections: "text" }],
    ["the row has no such field", { sections: [{ id: "r2" }] }],
  ])("is not found where %s", (_where, value) => {
    expect(unitValueIn(value, CAPTION)).toEqual({ found: false });
  });

  it("is never a member every object inherits", () => {
    expect(unitValueIn(document, [{ field: "toString" }])).toEqual({
      found: false,
    });
  });

  it("is not found in a block, which declares no text", () => {
    expect(
      unitValueIn({ page: { nodes: {} } }, [
        { field: "page" },
        { node: "n1", prop: "heading" },
      ])
    ).toEqual({ found: false });
  });
});

describe("a document with one text replaced", () => {
  it("changes a field's own text alone", () => {
    expect(withUnitValue(document, [{ field: "title" }], "Adiós")).toEqual({
      field: "title",
      value: "Adiós",
    });
  });

  it("changes one row's text, every other value and the order as they were", () => {
    const before = structuredClone(document);
    expect(withUnitValue(document, CAPTION, "Nuevo")).toEqual({
      field: "sections",
      value: [first, { ...second, caption: "Nuevo" }],
    });
    // The document it was made from is not touched.
    expect(document).toEqual(before);
  });

  it("changes a text in a list inside a list", () => {
    expect(withUnitValue(document, DEEP, "nuevo")).toEqual({
      field: "sections",
      value: [
        {
          ...first,
          points: [
            { id: "p1", text: "a" },
            { id: "p2", text: "nuevo" },
          ],
        },
        second,
      ],
    });
  });

  it("follows the row through a reorder", () => {
    const reordered = { sections: [second, first] };
    expect(withUnitValue(reordered, CAPTION, "Nuevo")).toEqual({
      field: "sections",
      value: [{ ...second, caption: "Nuevo" }, first],
    });
  });

  it("writes a text the row did not hold", () => {
    expect(
      withUnitValue({ sections: [{ id: "r2" }] }, CAPTION, "Nuevo")
    ).toEqual({ field: "sections", value: [{ id: "r2", caption: "Nuevo" }] });
  });

  it("writes into a group nothing was written in", () => {
    expect(
      withUnitValue(document, [{ field: "nothing" }, { field: "label" }], "X")
    ).toEqual({ field: "nothing", value: { label: "X" } });
  });

  it.each<[string, Record<string, unknown>]>([
    ["the row is gone", { sections: [first] }],
    ["the list is not there", {}],
    ["the list is null", { sections: null }],
    ["the list is no list", { sections: { id: "r2" } }],
  ])("has no place for it where %s", (_where, value) => {
    expect(withUnitValue(value, CAPTION, "Nuevo")).toBeUndefined();
  });
});

describe("a text left out of a document", () => {
  it.each<[string, Record<string, unknown>]>([
    ["its row was given without it", { sections: [{ id: "r2" }] }],
    ["the field it is in was left out", { title: "Hola" }],
    ["the row is JSON text", { sections: '[{"id":"r2"}]' }],
  ])("is withheld where %s", (_where, value) => {
    expect(unitWithheld(value, CAPTION)).toBe(true);
  });

  // Broken by taking every text that is not there for one withheld.
  it.each<[string, Record<string, unknown>]>([
    ["it is there", document],
    ["it is blank", { sections: [{ id: "r2", caption: null }] }],
    ["its row is gone", { sections: [first] }],
    ["nothing was written in its list", { sections: null }],
  ])("is not where %s", (_where, value) => {
    expect(unitWithheld(value, CAPTION)).toBe(false);
  });

  it("is not where nothing was ever written in its group", () => {
    const title: UnitAddress = [{ field: "seo" }, { field: "metaTitle" }];
    expect(unitWithheld({ seo: null }, title)).toBe(false);
    expect(unitWithheld({ seo: {} }, title)).toBe(true);
  });
});
