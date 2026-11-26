/**
 * A unit's address is what its suggestion and its record are found by, so two texts must never
 * share a spelling, one text must never have two, and a reordered list must change neither.
 */
import { describe, expect, it } from "vitest";

import {
  fieldUnit,
  isTextPath,
  parseUnitAddress,
  renamedUnit,
  rowProvenancePath,
  unitField,
  unitKey,
  unitProvenancePath,
  type UnitAddress,
} from "../unit-address";

const CAPTION: UnitAddress = [
  { field: "sections" },
  { row: "r1" },
  { field: "caption" },
];
const NESTED: UnitAddress = [
  { field: "sections" },
  { row: "r1" },
  { field: "points" },
  { row: "r2" },
  { field: "text" },
];
const GROUP: UnitAddress = [{ field: "seo" }, { field: "metaTitle" }];
const BLOCK: UnitAddress = [{ field: "page" }, { node: "n1", prop: "heading" }];

describe("an address as stored or sent", () => {
  it.each([
    ["a field's own text", fieldUnit("title")],
    ["a row's text", CAPTION],
    ["a text in a list inside a list", NESTED],
    ["a group's text", GROUP],
    ["a block's text", BLOCK],
  ])("reads back %s", (_what, address) => {
    const stored: unknown = JSON.parse(JSON.stringify(address));
    expect(parseUnitAddress(stored)).toEqual(address);
  });

  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["text", "title"],
    ["an empty list", []],
    ["a row first", [{ row: "r1" }, { field: "caption" }]],
    ["a block first", [{ node: "n1", prop: "heading" }]],
    ["a whole row", [{ field: "sections" }, { row: "r1" }]],
    [
      "a row of a row",
      [{ field: "sections" }, { row: "r1" }, { row: "r2" }, { field: "text" }],
    ],
    [
      "a step after a block's text",
      [{ field: "page" }, { node: "n1", prop: "heading" }, { field: "x" }],
    ],
    [
      "a block of a row",
      [{ field: "sections" }, { row: "r1" }, { node: "n1", prop: "heading" }],
    ],
    ["an empty name", [{ field: "" }]],
    ["an empty row id", [{ field: "sections" }, { row: "" }, { field: "x" }]],
    ["a number for an id", [{ field: "sections" }, { row: 1 }, { field: "x" }]],
    ["a step that is two", [{ field: "sections", row: "r1" }]],
    ["a block with no property", [{ field: "page" }, { node: "n1" }]],
    ["a step that is none", [{ field: "sections" }, { index: 0 }]],
  ])("refuses %s", (_what, value) => {
    expect(parseUnitAddress(value)).toBeNull();
  });

  it("starts in the document's own field", () => {
    expect(unitField(NESTED)).toBe("sections");
  });
});

describe("the key a unit is kept under", () => {
  it("is one per address, of one width, the same each time", () => {
    const keys = [fieldUnit("title"), CAPTION, NESTED, GROUP, BLOCK].map(
      unitKey
    );
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(unitKey(CAPTION)).toBe(keys[1]);
  });

  it("keeps apart names that run together", () => {
    expect(unitKey([{ field: "a" }, { field: "bc" }])).not.toBe(
      unitKey([{ field: "ab" }, { field: "c" }])
    );
    expect(unitKey([{ field: "a" }, { field: "b" }])).not.toBe(
      unitKey(fieldUnit("ab"))
    );
  });

  it("keeps apart a field and a row of one name", () => {
    const inGroup: UnitAddress = [
      { field: "a" },
      { field: "x" },
      { field: "t" },
    ];
    const inRow: UnitAddress = [{ field: "a" }, { row: "x" }, { field: "t" }];
    expect(unitKey(inGroup)).not.toBe(unitKey(inRow));
  });

  it("keeps apart ids that differ only by case", () => {
    const lower: UnitAddress = [{ field: "a" }, { row: "x" }, { field: "t" }];
    const upper: UnitAddress = [{ field: "a" }, { row: "X" }, { field: "t" }];
    expect(unitKey(lower)).not.toBe(unitKey(upper));
  });

  it("is of one width at any depth", () => {
    const deep: UnitAddress = [
      { field: "a" },
      ...Array.from({ length: 40 }, (_, level) => [
        { row: `row-${level}`.repeat(20) },
        { field: "points" },
      ]).flat(),
    ];
    expect(unitKey(deep)).toHaveLength(64);
  });
});

describe("the path a text's record is kept under", () => {
  it.each<[string, UnitAddress, string]>([
    ["a field's own text", fieldUnit("title"), "title"],
    ["a row's text", CAPTION, "sections#r1.caption"],
    ["a text in a list inside a list", NESTED, "sections#r1.points#r2.text"],
    ["a group's text", GROUP, "seo#.metaTitle"],
    [
      "a text in a group of a row",
      [
        { field: "sections" },
        { row: "r1" },
        { field: "cta" },
        { field: "label" },
      ],
      "sections#r1.cta.label",
    ],
    ["a block's text", BLOCK, "page#n1.heading"],
  ])("is %s", (_what, address, path) => {
    expect(unitProvenancePath(address)).toBe(path);
  });

  it("never reads an id's own characters as the path's", () => {
    const odd: UnitAddress = [
      { field: "a" },
      { row: "x.points#y" },
      { field: "t" },
    ];
    const nested: UnitAddress = [
      { field: "a" },
      { row: "x" },
      { field: "points" },
      { row: "y" },
      { field: "t" },
    ];
    expect(unitProvenancePath(odd)).not.toBe(unitProvenancePath(nested));
    expect(unitProvenancePath(odd)).toBe("a#x%2Epoints%23y.t");
  });
});

describe("what a record's path is of", () => {
  it.each<[string, string, boolean]>([
    ["a field", "title", false],
    ["a row", rowProvenancePath("sections", "r1"), false],
    // Its id would read as the way on to a text.
    ["a row whose id holds a dot", rowProvenancePath("sections", "r.1"), false],
    ["a row's text", unitProvenancePath(CAPTION), true],
    ["a nested row's text", unitProvenancePath(NESTED), true],
    ["a group's text", unitProvenancePath(GROUP), true],
    ["a block's text", unitProvenancePath(BLOCK), true],
  ])("is told for %s", (_what, path, text) => {
    expect(isTextPath(path)).toBe(text);
  });
});

describe("an address after its field is renamed", () => {
  it("is the same text under the new name", () => {
    expect(renamedUnit(CAPTION, "sections", "parts")).toEqual([
      { field: "parts" },
      { row: "r1" },
      { field: "caption" },
    ]);
    expect(unitKey(renamedUnit(CAPTION, "sections", "parts"))).not.toBe(
      unitKey(CAPTION)
    );
  });

  it("is as it was in another field, a nested field of that name included", () => {
    expect(renamedUnit(CAPTION, "caption", "label")).toEqual(CAPTION);
    expect(renamedUnit(fieldUnit("title"), "sections", "parts")).toEqual(
      fieldUnit("title")
    );
  });
});
