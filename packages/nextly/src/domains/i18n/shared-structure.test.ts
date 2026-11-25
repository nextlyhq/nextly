/**
 * A repeater or a group keeps one structure in every language: its rows, their order and their
 * shared values are stored once, and each language's translatable values inside it are kept
 * apart, keyed by row id (a group's by field name). These are the pure steps: which values inside
 * are translatable, splitting a written value into the structure and one language's overlay,
 * assembling a read from the structure and the overlays of a fallback chain, and pruning the
 * overlay entries of rows the structure no longer has.
 *
 * The plausible broken implementations each test rejects: matching overlay entries by position,
 * so a reorder hands one row's text to another; a fallback that takes a whole row from another
 * language instead of one field; a removed row's entry read back or left behind; and a second
 * list of translatable types beside the rule top-level fields are classified by.
 */
import { describe, expect, it } from "vitest";

import {
  assembleSharedStructure,
  componentFieldsChangingTranslation,
  componentStructureShape,
  holdsUnkeyedText,
  keepsTranslationsInside,
  pruneOverlay,
  sharedStructureShape,
  splitSharedStructure,
} from "./shared-structure";

const SLIDES = {
  name: "slides",
  type: "repeater",
  fields: [
    { name: "caption", type: "text" },
    { name: "alt", type: "textarea" },
    { name: "rank", type: "number" },
    { name: "code", type: "text", localized: false },
    { name: "label", type: "select", localized: true },
    {
      name: "points",
      type: "repeater",
      fields: [
        { name: "body", type: "richText" },
        { name: "score", type: "number" },
      ],
    },
  ],
};

const SEO = {
  name: "seo",
  type: "group",
  fields: [
    { name: "headline", type: "text" },
    { name: "weight", type: "number" },
  ],
};

const slidesShape = () => {
  const shape = sharedStructureShape(SLIDES);
  if (!shape) throw new Error("the slides repeater translates values inside");
  return shape;
};

describe("sharedStructureShape", () => {
  it("classifies the fields inside as top-level fields are classified, at every depth", () => {
    expect(slidesShape()).toEqual({
      kind: "repeater",
      texts: ["caption", "alt", "label"],
      inner: {
        points: { kind: "repeater", texts: ["body"], inner: {} },
      },
    });
    expect(sharedStructureShape(SEO)).toEqual({
      kind: "group",
      texts: ["headline"],
      inner: {},
    });
  });

  it("reads the fields of a group with no name as fields of the level that holds it", () => {
    expect(
      sharedStructureShape({
        name: "cards",
        type: "repeater",
        fields: [
          {
            type: "group",
            fields: [{ name: "title", type: "text" }],
          },
        ],
      })
    ).toEqual({ kind: "repeater", texts: ["title"], inner: {} });
  });

  it("is null for a container with nothing translatable inside, or one translated whole", () => {
    expect(
      sharedStructureShape({
        name: "prices",
        type: "repeater",
        fields: [
          { name: "amount", type: "number" },
          { name: "secret", type: "password", localized: true },
          { name: "sku", type: "text", localized: false },
        ],
      })
    ).toBeNull();
    expect(sharedStructureShape({ ...SLIDES, localized: true })).toBeNull();
    expect(sharedStructureShape({ name: "title", type: "text" })).toBeNull();
  });
});

describe("splitSharedStructure", () => {
  it("keeps ids, order and shared values on the structure and keys translatable values by row id", () => {
    const { structure, overlay } = splitSharedStructure(
      [
        {
          id: "r1",
          caption: "first",
          alt: "a1",
          rank: 1,
          code: "c1",
          label: "big",
          points: [{ id: "p1", body: "<p>one</p>", score: 7 }],
        },
        { id: "r2", caption: "second", rank: 2 },
      ],
      slidesShape()
    );
    expect(structure).toEqual([
      { id: "r1", rank: 1, code: "c1", points: [{ id: "p1", score: 7 }] },
      { id: "r2", rank: 2 },
    ]);
    expect(overlay).toEqual({
      r1: {
        caption: "first",
        alt: "a1",
        label: "big",
        points: { p1: { body: "<p>one</p>" } },
      },
      r2: { caption: "second" },
    });
  });

  it("keys a group's translatable values by field name", () => {
    const shape = sharedStructureShape(SEO)!;
    expect(
      splitSharedStructure({ headline: "Read me", weight: 5 }, shape)
    ).toEqual({ structure: { weight: 5 }, overlay: { headline: "Read me" } });
  });

  it("leaves the text of a row with no id on the structure rather than losing it", () => {
    const { structure, overlay } = splitSharedStructure(
      [{ caption: "orphan", rank: 3 }],
      slidesShape()
    );
    expect(structure).toEqual([{ caption: "orphan", rank: 3 }]);
    expect(overlay).toEqual({});
  });

  it("reads a value held as JSON text", () => {
    const { structure, overlay } = splitSharedStructure(
      JSON.stringify([{ id: "r1", caption: "first", rank: 1 }]),
      slidesShape()
    );
    expect(structure).toEqual([{ id: "r1", rank: 1 }]);
    expect(overlay).toEqual({ r1: { caption: "first" } });
  });
});

describe("assembleSharedStructure", () => {
  const structure = [
    { id: "r2", rank: 2, points: [{ id: "p1", score: 7 }] },
    { id: "r1", rank: 1 },
    { id: "r3", rank: 3 },
  ];
  const es = {
    r1: { caption: "primero" },
    r2: { caption: "segundo", points: { p1: { body: "uno" } } },
    gone: { caption: "borrado" },
  };
  const en = {
    r1: { caption: "first", alt: "a1" },
    r2: { caption: "second", alt: "a2", points: { p1: { body: "one" } } },
    r3: { caption: "third", alt: "" },
  };

  it("fills each row by its id, in the structure's order, whatever order the overlays hold", () => {
    expect(assembleSharedStructure(structure, [es, en], slidesShape())).toEqual(
      [
        {
          id: "r2",
          rank: 2,
          caption: "segundo",
          alt: "a2",
          label: null,
          points: [{ id: "p1", score: 7, body: "uno" }],
        },
        { id: "r1", rank: 1, caption: "primero", alt: "a1", label: null },
        { id: "r3", rank: 3, caption: "third", alt: null, label: null },
      ]
    );
  });

  it("falls back one field at a time, never a whole row", () => {
    const [, r1] = assembleSharedStructure(
      structure,
      [es, en],
      slidesShape()
    ) as Record<string, unknown>[];
    // Spanish holds the caption and not the alt text, which comes from English.
    expect(r1).toMatchObject({ caption: "primero", alt: "a1" });
  });

  it("reads one language alone when the chain is that language", () => {
    const rows = assembleSharedStructure(
      structure,
      [es],
      slidesShape()
    ) as Record<string, unknown>[];
    expect(rows.map(row => row.caption)).toEqual(["segundo", "primero", null]);
  });

  it("ignores entries of rows the structure does not hold", () => {
    expect(
      JSON.stringify(
        assembleSharedStructure(structure, [es, en], slidesShape())
      )
    ).not.toMatch(/borrado/);
  });

  it("reads a value the structure itself still holds where no language has one", () => {
    const rows = assembleSharedStructure(
      [{ id: "r9", rank: 9, caption: "kept on the row" }],
      [es, en],
      slidesShape()
    ) as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ caption: "kept on the row" });
  });

  it("fills a group by field name, and reads overlays and structure held as JSON text", () => {
    expect(
      assembleSharedStructure(
        JSON.stringify({ weight: 5 }),
        [
          JSON.stringify({ headline: "" }),
          JSON.stringify({ headline: "Read me" }),
        ],
        sharedStructureShape(SEO)!
      )
    ).toEqual({ weight: 5, headline: "Read me" });
  });

  it("is the value written, read back in the language that wrote it", () => {
    const written = [
      {
        id: "r1",
        caption: "first",
        alt: "a1",
        rank: 1,
        code: "c1",
        label: "big",
        points: [{ id: "p1", body: "one", score: 7 }],
      },
    ];
    const { structure: kept, overlay } = splitSharedStructure(
      written,
      slidesShape()
    );
    expect(assembleSharedStructure(kept, [overlay], slidesShape())).toEqual(
      written
    );
  });

  it("leaves an absent or null structure as it is", () => {
    expect(assembleSharedStructure(null, [en], slidesShape())).toBeNull();
    expect(assembleSharedStructure(undefined, [en], slidesShape())).toBe(
      undefined
    );
  });
});

describe("pruneOverlay", () => {
  it("drops the entries of rows the structure no longer holds, at every depth", () => {
    const { overlay, changed } = pruneOverlay(
      {
        r1: {
          caption: "primero",
          points: { p1: { body: "uno" }, p2: { body: "dos" } },
        },
        r2: { caption: "segundo" },
      },
      [{ id: "r1", points: [{ id: "p2" }] }],
      slidesShape()
    );
    expect(changed).toBe(true);
    expect(overlay).toEqual({
      r1: { caption: "primero", points: { p2: { body: "dos" } } },
    });
  });

  it("reports no change where every entry's row is still there", () => {
    const kept = { r1: { caption: "primero" } };
    const { overlay, changed } = pruneOverlay(
      JSON.stringify(kept),
      [{ id: "r1" }, { id: "r2" }],
      slidesShape()
    );
    expect(changed).toBe(false);
    expect(overlay).toEqual(kept);
  });

  // An instance that keeps its id but changes type no longer holds the earlier type's fields. Kept
  // in the other languages' overlays, that text would come back if the instance were changed back.
  describe("an instance changed to another component type", () => {
    const fieldsOf = (slug: string) =>
      slug === "hero"
        ? [{ name: "title", type: "text" }]
        : slug === "cta"
          ? [{ name: "label", type: "text" }]
          : undefined;

    // Fields as their config declares them, the components they offer among their keys.
    const layout = {
      name: "layout",
      type: "component",
      components: ["hero", "cta"],
      repeatable: true,
    };
    const lead = {
      name: "lead",
      type: "component",
      components: ["hero", "cta"],
    };

    it("drops the earlier type's text from a list's instance, keeping the new type's", () => {
      const shape = componentStructureShape(layout, fieldsOf)!;
      const { overlay, changed } = pruneOverlay(
        { i1: { title: "Hola", label: "Compra" } },
        [{ id: "i1", _componentType: "cta" }],
        shape
      );
      expect(changed).toBe(true);
      expect(overlay).toEqual({ i1: { label: "Compra" } });
    });

    it("drops the earlier type's text from a single instance", () => {
      const shape = componentStructureShape(lead, fieldsOf)!;
      const { overlay, changed } = pruneOverlay(
        { title: "Hola" },
        { _componentType: "cta" },
        shape
      );
      expect(changed).toBe(true);
      expect(overlay).toEqual({});
    });

    // The control: the instance kept its type, so nothing of its text goes.
    it("keeps an instance's text while its type stays", () => {
      const shape = componentStructureShape(lead, fieldsOf)!;
      expect(
        pruneOverlay({ title: "Hola" }, { _componentType: "hero" }, shape)
      ).toEqual({ overlay: { title: "Hola" }, changed: false });
    });
  });
});

describe("componentStructureShape", () => {
  const fieldsOf = (slug: string) =>
    slug === "hero"
      ? [{ name: "title", type: "text" }]
      : slug === "cta"
        ? [{ name: "label", type: "text" }]
        : undefined;

  // A field offering several component types holds one instance unless it is repeatable: its
  // value is an object, so its shape is a group's, and the instance's text is the language's.
  it("reads a component field offering several types but not repeatable as one instance", () => {
    // A field as its config declares it, the components it offers among its keys.
    const lead = {
      name: "lead",
      type: "component",
      components: ["hero", "cta"],
    };
    const shape = componentStructureShape(lead, fieldsOf);
    expect(shape?.kind).toBe("group");
    const { structure, overlay } = splitSharedStructure(
      { _componentType: "hero", title: "Hello" },
      shape!
    );
    expect(overlay).toEqual({ title: "Hello" });
    expect(structure).toEqual({ _componentType: "hero" });
  });

  // Each type's text is its own: a hero instance reads no cta field, and the reverse.
  it("reads a single instance by its own type's fields", () => {
    const fields = (slug: string) =>
      slug === "hero"
        ? [{ name: "title", type: "text" }]
        : slug === "cta"
          ? [{ name: "label", type: "text" }]
          : undefined;
    const lead = {
      name: "lead",
      type: "component",
      components: ["hero", "cta"],
    };
    const shape = componentStructureShape(lead, fields)!;
    const { structure, overlay } = splitSharedStructure(
      { _componentType: "hero", title: "Hello" },
      shape
    );
    expect(assembleSharedStructure(structure, [overlay], shape)).toEqual({
      _componentType: "hero",
      title: "Hello",
    });
  });

  it("reads a repeatable one as a list of instances", () => {
    const layout = {
      name: "layout",
      type: "component",
      components: ["hero", "cta"],
      repeatable: true,
    };
    const shape = componentStructureShape(layout, fieldsOf);
    expect(shape?.kind).toBe("repeater");
  });
});

describe("a container saying it is not translated", () => {
  // `localized: false` on a repeater or group means what it means on a top-level field: nothing
  // in it is translated, so it is shared whole and keeps no overlay.
  it("is shared whole, its text inside the same in every language", () => {
    expect(
      sharedStructureShape({
        name: "settings",
        type: "group",
        localized: false,
        fields: [{ name: "visibility", type: "text" }],
      })
    ).toBeNull();
    expect(
      keepsTranslationsInside(
        {
          name: "settings",
          type: "group",
          localized: false,
          fields: [{ name: "visibility", type: "text" }],
        },
        true
      )
    ).toBe(false);
  });

  it("adds nothing to the shape of the container it sits in", () => {
    expect(
      sharedStructureShape({
        name: "page",
        type: "group",
        fields: [
          { name: "heading", type: "text" },
          {
            name: "meta",
            type: "group",
            localized: false,
            fields: [{ name: "code", type: "text" }],
          },
        ],
      })
    ).toEqual({ kind: "group", texts: ["heading"], inner: {} });
  });

  // A component placed under `localized: false`, on itself or on a container around it, is shared
  // whole: it translates nothing, so a container holding nothing else keeps no overlay column.
  // Read as placing a component anyway, it would get an empty overlay column, and the column would
  // be guarded as though it held translations.
  it("places no component that says it is not translated", () => {
    const sharedCard = {
      name: "slides",
      type: "repeater",
      fields: [
        { name: "rank", type: "number" },
        {
          name: "card",
          type: "component",
          component: "card",
          localized: false,
        },
      ],
    };
    const insideShared = {
      name: "slides",
      type: "repeater",
      fields: [
        {
          name: "meta",
          type: "group",
          localized: false,
          fields: [{ name: "card", type: "component", component: "card" }],
        },
      ],
    };
    expect(keepsTranslationsInside(sharedCard, true)).toBe(false);
    expect(keepsTranslationsInside(insideShared, true)).toBe(false);
    // The control: the same component, translated, is placed.
    const translatedCard = {
      name: "slides",
      type: "repeater",
      fields: [{ name: "card", type: "component", component: "card" }],
    };
    expect(keepsTranslationsInside(translatedCard, true)).toBe(true);
  });

  // A group with no name only lays fields out, but saying it is not translated it shares the fields
  // it lays out, as the admin shows them: none of its text is any language's own.
  it("translates nothing laid out by a group with no name that says it is not translated", () => {
    expect(
      sharedStructureShape({
        name: "page",
        type: "group",
        fields: [
          { name: "heading", type: "text" },
          {
            type: "group",
            localized: false,
            fields: [{ name: "code", type: "text" }],
          },
        ],
      })
    ).toEqual({ kind: "group", texts: ["heading"], inner: {} });
  });
});

describe("rows keyed by an id their repeater declares", () => {
  const LINES = {
    name: "lines",
    type: "repeater",
    fields: [
      { name: "id", type: "number" },
      { name: "label", type: "text" },
    ],
  };
  const shape = () => sharedStructureShape(LINES)!;

  // A repeater declaring its own `id` field keeps that value as authored, a number among them:
  // each row's text is still the language's, keyed by the id's text.
  it("keeps a row's text apart by a numeric id", () => {
    const { structure, overlay } = splitSharedStructure(
      [
        { id: 7, label: "seven" },
        { id: 8, label: "eight" },
      ],
      shape()
    );
    expect(structure).toEqual([{ id: 7 }, { id: 8 }]);
    expect(overlay).toEqual({
      "7": { label: "seven" },
      "8": { label: "eight" },
    });
    expect(
      assembleSharedStructure(
        structure,
        [{ "7": { label: "siete" } }, overlay],
        shape()
      )
    ).toEqual([
      { id: 7, label: "siete" },
      { id: 8, label: "eight" },
    ]);
  });

  // A declared text `id` is the row's key, never its text: taken for text, it leaves the structure
  // for the overlay, so the structure's rows hold no id, no overlay entry is found for them, and
  // every text of those rows, the id among them, reads as none.
  it("keeps a declared text id on the structure, the row's text keyed by it", () => {
    const TEXT_LINES = {
      name: "lines",
      type: "repeater",
      fields: [
        { name: "id", type: "text" },
        { name: "label", type: "text" },
      ],
    };
    const textShape = sharedStructureShape(TEXT_LINES)!;
    expect(textShape.texts).toEqual(["label"]);
    const { structure, overlay } = splitSharedStructure(
      [
        { id: "a", label: "first" },
        { id: "b", label: "second" },
      ],
      textShape
    );
    expect(structure).toEqual([{ id: "a" }, { id: "b" }]);
    expect(overlay).toEqual({ a: { label: "first" }, b: { label: "second" } });
    expect(
      assembleSharedStructure(
        structure,
        [{ a: { label: "primero" } }, overlay],
        textShape
      )
    ).toEqual([
      { id: "a", label: "primero" },
      { id: "b", label: "second" },
    ]);
  });

  // Two rows under one id would share one overlay entry, one row's text read on the other.
  it("keeps the text of a row repeating an earlier row's id on the structure", () => {
    const { structure, overlay } = splitSharedStructure(
      [
        { id: 7, label: "first" },
        { id: 7, label: "second" },
      ],
      shape()
    );
    expect(overlay).toEqual({ "7": { label: "first" } });
    expect(structure).toEqual([{ id: 7 }, { id: 7, label: "second" }]);
    expect(assembleSharedStructure(structure, [overlay], shape())).toEqual([
      { id: 7, label: "first" },
      { id: 7, label: "second" },
    ]);
  });
});

describe("an overlay held as the container's whole value", () => {
  // The default language's overlay seeded from a container that kept its text on the main table
  // before is its whole value: it reads as that language's text.
  it("reads as the text alone", () => {
    expect(
      assembleSharedStructure(
        [{ id: "r1", rank: 1 }],
        [[{ id: "r1", caption: "first", rank: 9 }]],
        slidesShape()
      )
    ).toEqual([
      expect.objectContaining({ id: "r1", caption: "first", rank: 1 }),
    ]);
  });
});

describe("holdsUnkeyedText", () => {
  it("finds text on a row with no id, and on one whose id an earlier row holds", () => {
    expect(
      holdsUnkeyedText([{ caption: "first", rank: 1 }], slidesShape())
    ).toBe(true);
    expect(
      holdsUnkeyedText(
        [
          { id: "r1", caption: "first" },
          { id: "r1", caption: "again" },
        ],
        slidesShape()
      )
    ).toBe(true);
  });

  it("finds text on a row with no id inside a row that has one", () => {
    expect(
      holdsUnkeyedText(
        [{ id: "r1", rank: 1, points: [{ body: "inner", score: 2 }] }],
        slidesShape()
      )
    ).toBe(true);
  });

  it("finds none where every row with text has its id, or a row with no id holds no text", () => {
    expect(
      holdsUnkeyedText(
        [{ id: "r1", caption: "first", points: [{ id: "p1", body: "inner" }] }],
        slidesShape()
      )
    ).toBe(false);
    // Shared values alone, or blank text: nothing a split would leave on the structure as text.
    expect(
      holdsUnkeyedText([{ rank: 1, code: "A", caption: "" }], slidesShape())
    ).toBe(false);
    expect(
      holdsUnkeyedText({ headline: "Title" }, sharedStructureShape(SEO)!)
    ).toBe(false);
  });
});

describe("componentFieldsChangingTranslation", () => {
  const CARD = [
    { name: "label", type: "text" },
    { name: "size", type: "number" },
    {
      name: "notes",
      type: "repeater",
      fields: [{ name: "body", type: "text" }],
    },
  ];

  it("names a field kept through the edit and turned shared or translated", () => {
    expect(
      componentFieldsChangingTranslation("card", CARD, [
        { name: "label", type: "text", localized: false },
        CARD[1]!,
        CARD[2]!,
      ])
    ).toEqual(["label"]);
    // A number turned translated: its value is now read per language.
    expect(
      componentFieldsChangingTranslation("card", CARD, [
        CARD[0]!,
        { name: "size", type: "number", localized: true },
        CARD[2]!,
      ])
    ).toEqual(["size"]);
  });

  it("names a container inside whose text changes so", () => {
    expect(
      componentFieldsChangingTranslation("card", CARD, [
        CARD[0]!,
        CARD[1]!,
        {
          name: "notes",
          type: "repeater",
          fields: [{ name: "body", type: "text", localized: false }],
        },
      ])
    ).toEqual(["notes"]);
  });

  it("names none for an unchanged field group, or one whose fields are only added or removed", () => {
    expect(componentFieldsChangingTranslation("card", CARD, CARD)).toEqual([]);
    expect(
      componentFieldsChangingTranslation("card", CARD, [
        ...CARD,
        { name: "caption", type: "text" },
      ])
    ).toEqual([]);
    expect(
      componentFieldsChangingTranslation("card", CARD, [CARD[1]!, CARD[2]!])
    ).toEqual([]);
  });
});
