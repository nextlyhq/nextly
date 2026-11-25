/**
 * Whether unsaved edits change what every language shares. The plausible broken versions: any
 * edit counts as shared (the choice on every publish), none does (a shared change goes live in
 * every language unannounced), an edit inside a shared group is missed, the text inside a
 * repeater, a group or a component counts as shared though it is the language's own, and a row
 * added, removed or moved does not.
 */
import type { FieldConfig } from "nextly/config";
import { describe, expect, it } from "vitest";

import { editsSharedFields } from "../shared-edits";

type Values = Record<string, unknown>;

/** Whether going from `startedFrom` to `current` changes what a translated document shares. */
function edits(
  fields: readonly unknown[],
  startedFrom: Values,
  current: Values,
  localized = true
): boolean {
  return editsSharedFields({
    fields: fields as FieldConfig[],
    localized,
    startedFrom,
    current,
  });
}

/** The same, for one field called `at`. */
const edited = (field: object, before: unknown, after: unknown): boolean =>
  edits([{ ...field, name: "at" }], { at: before }, { at: after });

const CAPTION = { type: "text", name: "caption" };
const RANK = { type: "number", name: "rank" };
const CODE = { type: "text", name: "code", localized: false };

describe("a field of its own", () => {
  const FIELDS = [
    { type: "text", name: "title" },
    { type: "number", name: "price" },
    { type: "relationship", name: "author", relationTo: "people" },
  ];
  const startedFrom = {
    title: "Hello",
    price: 10,
    author: { id: "a1", name: "Ada" },
  };
  const change = (values: Values, localized = true) =>
    edits(FIELDS, startedFrom, { ...startedFrom, ...values }, localized);

  it("is false for no edit, and for an edit to a translated field alone", () => {
    expect(change({})).toBe(false);
    expect(change({ title: "Hello again" })).toBe(false);
    expect(change({ title: "" })).toBe(false);
  });

  it("is true for an edit to a shared field, beside a translated one or alone", () => {
    expect(change({ price: 12 })).toBe(true);
    expect(change({ title: "Hello again", price: 12 })).toBe(true);
  });

  it("is false for a shared value held another way: a document by its id", () => {
    expect(change({ author: "a1" })).toBe(false);
    expect(change({ author: "a2" })).toBe(true);
  });

  it("is true for any edit where the document is not translated", () => {
    expect(change({ title: "Hello again" }, false)).toBe(true);
  });
});

describe("a named group", () => {
  const GROUP = {
    type: "group",
    fields: [
      CAPTION,
      RANK,
      CODE,
      { type: "group", name: "inner", fields: [CAPTION, RANK] },
    ],
  };
  const BEFORE = {
    caption: "One",
    rank: 1,
    code: "a",
    inner: { caption: "Deep", rank: 2 },
  };

  it("is false for its text, at any depth: written, changed or cleared", () => {
    expect(edited(GROUP, BEFORE, { ...BEFORE, caption: "Two" })).toBe(false);
    expect(edited(GROUP, BEFORE, { ...BEFORE, caption: "" })).toBe(false);
    expect(
      edited(GROUP, { ...BEFORE, caption: null }, { ...BEFORE, caption: "Two" })
    ).toBe(false);
    expect(
      edited(GROUP, BEFORE, { ...BEFORE, inner: { caption: "New", rank: 2 } })
    ).toBe(false);
  });

  it("is true for an untranslated value inside it, at any depth", () => {
    expect(edited(GROUP, BEFORE, { ...BEFORE, rank: 9 })).toBe(true);
    expect(edited(GROUP, BEFORE, { ...BEFORE, code: "b" })).toBe(true);
    expect(
      edited(GROUP, BEFORE, { ...BEFORE, inner: { caption: "Deep", rank: 9 } })
    ).toBe(true);
    expect(edited(GROUP, BEFORE, { ...BEFORE, caption: "Two", rank: 9 })).toBe(
      true
    );
  });

  it("is true for its text where the group says it is not translated", () => {
    expect(
      edited({ ...GROUP, localized: false }, BEFORE, {
        ...BEFORE,
        caption: "Two",
      })
    ).toBe(true);
  });

  it("is true for the text of a group inside it saying so", () => {
    const fields = [
      { type: "group", name: "inner", localized: false, fields: [CAPTION] },
    ];
    expect(
      edited(
        { type: "group", fields },
        { inner: { caption: "One" } },
        { inner: { caption: "Two" } }
      )
    ).toBe(true);
  });
});

describe("a repeater", () => {
  const REPEATER = {
    type: "repeater",
    fields: [
      CAPTION,
      RANK,
      CODE,
      { type: "repeater", name: "items", fields: [CAPTION, RANK] },
    ],
  };
  const ONE = {
    id: "r1",
    caption: "One",
    rank: 1,
    code: "a",
    items: [{ id: "i1", caption: "Deep", rank: 5 }],
  };
  const TWO = { id: "r2", caption: "Two", rank: 2, code: "b", items: [] };
  const change = (after: unknown[]) => edited(REPEATER, [ONE, TWO], after);

  it("is false for the text in its rows, nested rows included: changed or cleared", () => {
    expect(change([{ ...ONE, caption: "Uno" }, TWO])).toBe(false);
    expect(change([{ ...ONE, caption: "" }, TWO])).toBe(false);
    expect(
      change([
        { ...ONE, items: [{ id: "i1", caption: "Hondo", rank: 5 }] },
        TWO,
      ])
    ).toBe(false);
  });

  it("is true for an untranslated value in a row, nested rows included", () => {
    expect(change([{ ...ONE, rank: 9 }, TWO])).toBe(true);
    expect(change([{ ...ONE, code: "z" }, TWO])).toBe(true);
    expect(
      change([{ ...ONE, items: [{ id: "i1", caption: "Deep", rank: 9 }] }, TWO])
    ).toBe(true);
  });

  it("is true for a row added, removed or moved, nested rows included", () => {
    const added = { id: "r3", caption: "Three", rank: 3, code: "c", items: [] };
    expect(change([ONE, TWO, added])).toBe(true);
    // A row just added has no id until it is stored.
    expect(change([ONE, TWO, { caption: "Three" }])).toBe(true);
    expect(change([ONE])).toBe(true);
    expect(change([])).toBe(true);
    expect(change([TWO, ONE])).toBe(true);
    expect(change([{ ...ONE, items: [] }, TWO])).toBe(true);
  });

  it("is true for a moved row whose text changed too, and for two rows swapping their text alone it is false", () => {
    expect(change([{ ...TWO, caption: "Dos" }, ONE])).toBe(true);
    expect(
      change([
        { ...ONE, caption: "Two" },
        { ...TWO, caption: "One" },
      ])
    ).toBe(false);
  });

  it("is true for the text of rows with no id, which storage keeps shared", () => {
    expect(edited(REPEATER, [{ caption: "One" }], [{ caption: "Two" }])).toBe(
      true
    );
  });

  it("is true for its text where the repeater says it is not translated", () => {
    expect(
      edited(
        { ...REPEATER, localized: false },
        [ONE],
        [{ ...ONE, caption: "Uno" }]
      )
    ).toBe(true);
  });

  it("is true for any edit to one that holds no text", () => {
    const numbers = { type: "repeater", fields: [RANK] };
    expect(
      edited(numbers, [{ id: "r1", rank: 1 }], [{ id: "r1", rank: 2 }])
    ).toBe(true);
  });
});

describe("a component", () => {
  // As the collection's read hands it: with the fields of the component it places.
  const HERO = {
    type: "component",
    component: "hero",
    componentFields: [CAPTION, RANK],
  };
  const ONE = { id: "c1", _componentType: "hero", caption: "One", rank: 1 };

  it("is false for its text, and true for an untranslated value", () => {
    expect(edited(HERO, ONE, { ...ONE, caption: "Uno" })).toBe(false);
    expect(edited(HERO, ONE, { ...ONE, rank: 9 })).toBe(true);
  });

  it("is true for an instance added, removed or replaced", () => {
    expect(edited(HERO, null, ONE)).toBe(true);
    expect(edited(HERO, ONE, null)).toBe(true);
    expect(edited(HERO, ONE, { ...ONE, id: "c2", caption: "New" })).toBe(true);
  });

  it("reads a list of them as rows, by id", () => {
    const list = { ...HERO, repeatable: true };
    const two = { id: "c2", _componentType: "hero", caption: "Two", rank: 2 };
    expect(edited(list, [ONE, two], [{ ...ONE, caption: "Uno" }, two])).toBe(
      false
    );
    expect(edited(list, [ONE, two], [two, ONE])).toBe(true);
    expect(edited(list, [ONE, two], [ONE])).toBe(true);
    expect(edited(list, [ONE, two], [ONE, { ...two, rank: 9 }])).toBe(true);
  });

  it("reads each instance of one offering several by its own component's fields", () => {
    const zone = {
      type: "component",
      components: ["hero", "fact"],
      repeatable: true,
      componentSchemas: {
        hero: { fields: [CAPTION, RANK] },
        fact: { fields: [{ ...CAPTION, localized: false }] },
      },
    };
    const fact = { id: "c2", _componentType: "fact", caption: "Two" };
    expect(edited(zone, [ONE, fact], [{ ...ONE, caption: "Uno" }, fact])).toBe(
      false
    );
    expect(edited(zone, [ONE, fact], [ONE, { ...fact, caption: "Dos" }])).toBe(
      true
    );
  });

  it("reads one placed in a repeater's rows the same way", () => {
    const rows = {
      type: "repeater",
      fields: [{ ...HERO, name: "hero" }],
    };
    const row = (hero: object) => [{ id: "r1", hero }];
    expect(edited(rows, row(ONE), row({ ...ONE, caption: "Uno" }))).toBe(false);
    expect(edited(rows, row(ONE), row({ ...ONE, rank: 9 }))).toBe(true);
  });
});

describe("a nameless layout", () => {
  // Its values are stored beside it, on the row every language shares.
  const HERO = {
    type: "component",
    name: "hero",
    component: "hero",
    componentFields: [CAPTION, RANK],
  };
  const FIELDS = [
    { type: "text", name: "title" },
    {
      type: "group",
      fields: [
        { type: "text", name: "subtitle" },
        { type: "row", fields: [{ type: "number", name: "stock" }] },
        { type: "group", name: "seo", fields: [CAPTION] },
        HERO,
      ],
    },
  ];
  const BEFORE = {
    title: "Hello",
    subtitle: "Hi",
    stock: 4,
    seo: { caption: "One" },
    hero: { id: "c1", _componentType: "hero", caption: "One", rank: 1 },
  };
  const change = (values: Values) =>
    edits(FIELDS, BEFORE, { ...BEFORE, ...values });

  it("is true for a value inside it, its text and nested layouts included", () => {
    expect(change({})).toBe(false);
    expect(change({ stock: 5 })).toBe(true);
    expect(change({ subtitle: "Hi again" })).toBe(true);
    expect(change({ seo: { caption: "Two" } })).toBe(true);
  });

  it("is false for the text of a component inside it, which is stored apart from the row", () => {
    expect(change({ hero: { ...BEFORE.hero, caption: "Uno" } })).toBe(false);
    expect(change({ hero: { ...BEFORE.hero, rank: 9 } })).toBe(true);
  });
});
