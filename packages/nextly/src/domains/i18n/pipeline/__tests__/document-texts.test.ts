/**
 * A document's texts are listed exactly where a language keeps one: each by an address that finds
 * it again, none for a shared value, and none for a row no language could keep text for.
 */
import { describe, expect, it } from "vitest";

import { currentFieldGroupTypeKey } from "../../../field-groups/storage/field-group-type-key";
import {
  sharedStructureShape,
  type SharedStructureShape,
} from "../../shared-structure";
import {
  documentTexts,
  overlayTexts,
  readTexts,
  type TranslatableFields,
} from "../document-texts";
import { unitProvenancePath } from "../unit-address";
import { unitValueIn } from "../unit-value";

const POINTS: SharedStructureShape = {
  kind: "repeater",
  texts: ["text"],
  inner: {},
};
const SECTIONS: SharedStructureShape = {
  kind: "repeater",
  texts: ["caption"],
  inner: { points: POINTS },
};
const SEO: SharedStructureShape = {
  kind: "group",
  texts: ["metaTitle"],
  inner: {},
};

const fields: TranslatableFields = {
  names: ["title", "sections", "seo"],
  shapes: new Map([
    ["sections", SECTIONS],
    ["seo", SEO],
  ]),
};

const first = {
  id: "r1",
  price: 10,
  caption: "Uno",
  points: [{ id: "p1", text: "a" }],
};
const second = { id: "r2", price: 20, caption: "Dos", points: [] };
const document = {
  title: "Hola",
  price: 5,
  sections: [first, second],
  seo: { metaTitle: "Meta", image: "i1" },
};

/** The texts by the path each is recorded under, which reads as one string. */
const paths = (
  value: Record<string, unknown>,
  of: TranslatableFields = fields
): string[] => documentTexts(value, of).map(unitProvenancePath);

describe("a document's texts", () => {
  it("are its fields', rows' and groups' translatable ones, in order, and no shared value", () => {
    expect(paths(document)).toEqual([
      "title",
      "sections#r1.caption",
      "sections#r1.points#p1.text",
      "sections#r2.caption",
      "seo#.metaTitle",
    ]);
  });

  it("are each found again by their address", () => {
    const found = documentTexts(document, fields).map(address =>
      unitValueIn(document, address)
    );
    expect(found).toEqual(
      ["Hola", "Uno", "a", "Dos", "Meta"].map(value => ({ found: true, value }))
    );
  });

  it("are the same texts in the rows' new order after a reorder", () => {
    const reordered = { ...document, sections: [second, first] };
    expect(paths(reordered).slice(1, 4)).toEqual([
      "sections#r2.caption",
      "sections#r1.caption",
      "sections#r1.points#p1.text",
    ]);
    expect(new Set(paths(reordered))).toEqual(new Set(paths(document)));
  });

  it("are listed where nothing is written yet, a row's and a group's", () => {
    expect(paths({ sections: [{ id: "r1" }], seo: null })).toEqual([
      "sections#r1.caption",
      "seo#.metaTitle",
    ]);
  });

  // Broken by leaving out of a container's stored structure the texts each language holds apart.
  it("are every one a container's shape has, whatever its rows hold", () => {
    expect(paths({ sections: [{ id: "r1" }], seo: { image: "i1" } })).toEqual([
      "sections#r1.caption",
      "seo#.metaTitle",
    ]);
  });

  it("are read from a list kept as JSON text", () => {
    const stored = { sections: JSON.stringify([first]) };
    expect(paths(stored)).toEqual([
      "sections#r1.caption",
      "sections#r1.points#p1.text",
    ]);
  });

  it("are none of a field the document does not hold", () => {
    expect(paths({ title: "Hola" })).toEqual(["title"]);
  });

  it.each<[string, unknown]>([
    ["no id", [{ caption: "Uno" }]],
    ["an empty id", [{ id: "", caption: "Uno" }]],
    ["no shape of a row", ["text", null]],
  ])("are none of a row with %s", (_what, sections) => {
    expect(paths({ sections })).toEqual([]);
  });

  it("are never a row's own declared id, which is what its text is found by", () => {
    const shape = sharedStructureShape({
      name: "sections",
      type: "repeater",
      fields: [
        { name: "id", type: "text" },
        { name: "caption", type: "text" },
      ],
    });
    if (shape === null) throw new Error("the list translates nothing");
    expect(
      paths(
        { sections: [{ id: "intro", caption: "Uno" }] },
        { names: ["sections"], shapes: new Map([["sections", shape]]) }
      )
    ).toEqual(["sections#intro.caption"]);
  });

  it("are the first row's alone where two rows hold one id", () => {
    expect(paths({ sections: [second, { ...second }] })).toEqual([
      "sections#r2.caption",
    ]);
  });

  it.each<[string, unknown]>([
    ["a list", null],
    ["a list", "text"],
    ["a group", []],
  ])("are none where %s holds something else", (kind, value) => {
    expect(
      paths(kind === "a list" ? { sections: value } : { seo: value })
    ).toEqual([]);
  });

  it("are read by each instance's own component type in a list of several", () => {
    const zone: SharedStructureShape = {
      kind: "repeater",
      texts: ["heading", "quote"],
      inner: {},
      byType: {
        hero: { kind: "repeater", texts: ["heading"], inner: {} },
        quote: { kind: "repeater", texts: ["quote"], inner: {} },
      },
    };
    const value = {
      blocks: [
        { id: "a", [currentFieldGroupTypeKey]: "hero", heading: "H" },
        { id: "b", [currentFieldGroupTypeKey]: "quote", quote: "Q" },
      ],
    };
    expect(
      paths(value, { names: ["blocks"], shapes: new Map([["blocks", zone]]) })
    ).toEqual(["blocks#a.heading", "blocks#b.quote"]);
  });
});

describe("a document's texts as it was read", () => {
  const read = (value: Record<string, unknown>) =>
    readTexts(value, fields).map(unitProvenancePath);

  it("are all of them where nothing was left out, blank ones and a group never written in too", () => {
    expect(read(document)).toEqual(paths(document));
    expect(
      read({ sections: [{ id: "r1", caption: null }], seo: null })
    ).toEqual(["sections#r1.caption", "seo#.metaTitle"]);
  });

  // Broken by listing every text a row's or a group's shape has.
  it("are none a row or a group was given without, as to one who may not read it", () => {
    const { points } = first;
    expect(
      read({ sections: [{ id: "r1", points }], seo: { image: "i1" } })
    ).toEqual(["sections#r1.points#p1.text"]);
    expect(read({ sections: [{ id: "r1", caption: "Uno" }] })).toEqual([
      "sections#r1.caption",
    ]);
  });
});

describe("the texts a language's own column holds for a container", () => {
  const held = (
    field: string,
    stored: unknown,
    shape: SharedStructureShape
  ): [string, unknown][] =>
    overlayTexts(field, stored, shape).map(([address, value]) => [
      unitProvenancePath(address),
      value,
    ]);
  const overlay = {
    r1: { caption: "Uno", points: { p1: { text: "a" } } },
    r2: { caption: "" },
  };
  const texts = [
    ["sections#r1.caption", "Uno"],
    ["sections#r1.points#p1.text", "a"],
    ["sections#r2.caption", ""],
  ];

  it.each<[string, unknown]>([
    ["a value", overlay],
    ["JSON text", JSON.stringify(overlay)],
  ])(
    "are each by the path a document's text has, stored as %s",
    (_as, stored) => {
      expect(held("sections", stored, SECTIONS)).toEqual(texts);
    }
  );

  it("are a group's by its fields, and none of a value it shares", () => {
    expect(held("seo", { metaTitle: "Meta", image: "i1" }, SEO)).toEqual([
      ["seo#.metaTitle", "Meta"],
    ]);
  });

  it("are read from a container held whole, as it was before its text was apart", () => {
    expect(held("sections", [first], SECTIONS)).toEqual([
      ["sections#r1.caption", "Uno"],
      ["sections#r1.points#p1.text", "a"],
    ]);
  });

  it.each([null, "", "{", []])("are none of %j", stored => {
    expect(held("sections", stored, SECTIONS)).toEqual([]);
  });
});
