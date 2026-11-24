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
  componentStructureShape,
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
    const shape = componentStructureShape(
      { name: "lead", type: "component", components: ["hero", "cta"] },
      fieldsOf
    );
    expect(shape?.kind).toBe("group");
    const { structure, overlay } = splitSharedStructure(
      { _componentType: "hero", title: "Hello" },
      shape!
    );
    expect(overlay).toEqual({ title: "Hello" });
    expect(structure).toEqual({ _componentType: "hero" });
  });

  it("reads a repeatable one as a list of instances", () => {
    const shape = componentStructureShape(
      {
        name: "layout",
        type: "component",
        components: ["hero", "cta"],
        repeatable: true,
      },
      fieldsOf
    );
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
});
