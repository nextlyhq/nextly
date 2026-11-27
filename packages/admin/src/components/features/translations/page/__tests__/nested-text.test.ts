/**
 * The text inside containers: which of it is written, under which row, and a
 * save that changes that text and nothing around it. A row is the same row by
 * its id in every language, never by its place.
 */
import type { FieldConfig } from "nextly/config";
import { describe, expect, it } from "vitest";

import {
  heldValue,
  holdsText,
  nestedPayload,
  ontoCurrent,
  textLevel,
  textPerLanguage,
  textsIn,
  writtenContainer,
} from "../nested-text";
import type { TranslationField } from "../translation-fields";

const field = (
  name: string | undefined,
  type: string,
  extra: Record<string, unknown> = {}
): FieldConfig =>
  ({ ...(name === undefined ? {} : { name }), type, ...extra }) as never;

const container = (declared: FieldConfig): TranslationField => ({
  field: declared,
  name: (declared as { name: string }).name,
  label: (declared as { name: string }).name,
});

/** A repeater with a caption of its own, a shared number, and points inside. */
const SLIDES = container(
  field("slides", "repeater", {
    labels: { singular: "Slide" },
    fields: [
      field("caption", "text"),
      field("position", "number"),
      field("points", "repeater", { fields: [field("note", "textarea")] }),
    ],
  })
);

const STORED = [
  {
    id: "a",
    caption: "Uno",
    position: 1,
    points: [{ id: "p", note: "Nota" }],
  },
  { id: "b", caption: null, position: 2, points: [] },
];

const texts = (of: TranslationField, value: unknown) =>
  textsIn(textLevel(of, value)).map(({ path, label }) => [path, label]);

describe("holdsText", () => {
  it("is so of text, and of what holds some, at any depth", () => {
    expect(holdsText(field("caption", "text"))).toBe(true);
    expect(holdsText(SLIDES.field)).toBe(true);
    expect(holdsText(field("price", "number"))).toBe(false);
    expect(holdsText(field("price", "number", { localized: true }))).toBe(true);
    expect(holdsText(field("code", "text", { localized: false }))).toBe(false);
  });
});

describe("textLevel", () => {
  it("is each row's texts under the row's own name, at every depth", () => {
    expect(texts(SLIDES, STORED)).toEqual([
      ["slides.0.caption", "Slide 1, Caption"],
      ["slides.0.points.0.note", "Slide 1, Points 1, Note"],
      ["slides.1.caption", "Slide 2, Caption"],
    ]);
  });

  it("reads a group by its fields, and a condition beside them", () => {
    const intro = container(
      field("intro", "group", {
        label: "Introduction",
        fields: [field("heading", "text"), field("width", "number")],
      })
    );
    const level = textLevel(intro, { heading: "Hola", width: 3 });
    expect(level?.label).toBe("Introduction");
    expect(textsIn(level)).toMatchObject([
      {
        path: "intro.heading",
        basePath: "intro",
        label: "Introduction, Heading",
      },
    ]);
  });

  it("reads a component's instance by the component it is", () => {
    const zone = container(
      field("zone", "fieldGroup", {
        repeatable: true,
        componentSchemas: {
          hero: { fields: [field("title", "text")] },
          cta: { fields: [field("button", "text")] },
        },
      })
    );
    expect(
      texts(zone, [
        { id: "h", _componentType: "hero", title: "Hola", button: "no" },
        { id: "c", _componentType: "cta", button: "Ir" },
        { id: "x", _componentType: "gone", title: "Hola" },
      ])
    ).toEqual([
      ["zone.0.title", "Zone 1, Title"],
      ["zone.1.button", "Zone 2, Button"],
    ]);
  });

  it("reads into a group that only lays fields out, keeping its condition", () => {
    const layout = field(undefined, "group", {
      fields: [field("caption", "text")],
      admin: { condition: { field: "kind", equals: "photo" } },
    });
    const gallery = container(
      field("gallery", "repeater", { fields: [layout] })
    );
    const row = textLevel(gallery, [{ id: "a", caption: "Uno" }])?.levels[0];
    expect(row?.levels[0]).toMatchObject({
      label: undefined,
      field: layout,
      basePath: "gallery.0",
      texts: [{ path: "gallery.0.caption" }],
    });
  });

  it("offers nothing of a row no id tells from the others", () => {
    expect(
      texts(SLIDES, [
        { caption: "No id" },
        { id: "a", caption: "First" },
        { id: "a", caption: "Repeated" },
        { id: "", caption: "Blank" },
        { id: 7, caption: "Numbered" },
      ])
    ).toEqual([
      ["slides.1.caption", "Slide 2, Caption"],
      ["slides.4.caption", "Slide 5, Caption"],
    ]);
  });

  it("never offers the id a repeater declares of its own", () => {
    const lines = container(
      field("lines", "repeater", {
        fields: [
          field("id", "text"),
          field("label", "text"),
          field("meta", "group", { fields: [field("id", "text")] }),
        ],
      })
    );
    expect(
      texts(lines, [{ id: "l1", label: "Uno", meta: { id: "its own text" } }])
    ).toEqual([
      ["lines.0.label", "Lines 1, Label"],
      ["lines.0.meta.id", "Lines 1, Meta, Id"],
    ]);
  });

  it("leaves out what the reader may not see, what is hidden and what is shared", () => {
    const list = container(
      field("list", "repeater", {
        fields: [
          field("shown", "text"),
          field("withheld", "text"),
          field("hidden", "text", { admin: { hidden: true } }),
          field("shared", "text", { localized: false }),
          field("inside", "group", {
            localized: false,
            fields: [field("text", "text")],
          }),
        ],
      })
    );
    expect(
      texts(list, [
        {
          id: "a",
          shown: "x",
          hidden: "x",
          shared: "x",
          inside: { text: "x" },
        },
      ])
    ).toEqual([["list.0.shown", "List 1, Shown"]]);
  });

  it("is nothing where there is nothing to write", () => {
    expect(textLevel(SLIDES, [])).toBeUndefined();
    expect(textLevel(SLIDES, null)).toBeUndefined();
    expect(textLevel(SLIDES, "text")).toBeUndefined();
  });
});

describe("heldValue", () => {
  it("is a component's one instance, which a read may answer in a list", () => {
    const seo = field("seo", "fieldGroup", {
      componentFields: [field("title", "text")],
    });
    expect(heldValue(seo, [{ id: "s", title: "Hola" }])).toEqual({
      id: "s",
      title: "Hola",
    });
    const list = field("seo", "fieldGroup", { repeatable: true });
    expect(heldValue(list, [{ id: "s" }])).toEqual([{ id: "s" }]);
  });

  it("is nothing for nothing, not an empty group", () => {
    const intro = field("intro", "group", { fields: [field("a", "text")] });
    expect(heldValue(intro, null)).toBeNull();
    expect(heldValue(intro, undefined)).toBeNull();
  });
});

describe("writtenContainer", () => {
  const write = (shown: unknown, base: unknown = STORED) =>
    writtenContainer(SLIDES, base, { slides: shown });

  it("changes the text and nothing around it", () => {
    const shown = structuredClone(STORED) as Record<string, unknown>[];
    shown[0]!.caption = "Una";
    // A structure or a shared value the form holds otherwise is not its to say.
    shown[0]!.position = 99;
    const { value, changed } = write(shown);
    expect(changed.map(text => text.path)).toEqual(["slides.0.caption"]);
    expect(value).toEqual([{ ...STORED[0], caption: "Una" }, STORED[1]]);
  });

  it("writes a text inside a row inside a row", () => {
    const shown = structuredClone(STORED);
    shown[0]!.points[0]!.note = "Otra";
    expect(write(shown).value).toEqual([
      { ...STORED[0], points: [{ id: "p", note: "Otra" }] },
      STORED[1],
    ]);
  });

  it("knows a row by its id, wherever the form has it", () => {
    const [a, b] = structuredClone(STORED);
    const { value, changed } = write([{ ...b!, caption: "Dos" }, a!]);
    expect(changed.map(text => text.path)).toEqual(["slides.1.caption"]);
    expect(value).toEqual([STORED[0], { ...STORED[1], caption: "Dos" }]);
  });

  it("keeps a row the form does not hold", () => {
    const { value, changed } = write([structuredClone(STORED[0])]);
    expect(changed).toEqual([]);
    expect(value).toBe(STORED);
  });

  it("writes an emptied text as no value, and says whether it wrote any", () => {
    const shown = structuredClone(STORED) as Record<string, unknown>[];
    shown[0]!.caption = "";
    const emptied = write(shown);
    expect((emptied.value as Record<string, unknown>[])[0]?.caption).toBeNull();
    expect(emptied.wrote).toBe(false);
    shown[0]!.caption = "Una";
    expect(write(shown).wrote).toBe(true);
  });

  it("takes an empty text for the nothing it was", () => {
    const shown = structuredClone(STORED) as Record<string, unknown>[];
    shown[1]!.caption = "";
    expect(write(shown).changed).toEqual([]);
  });
});

describe("nestedPayload", () => {
  const LINKS = container(
    field("links", "repeater", { fields: [field("label", "text")] })
  );
  const startedFrom = {
    slides: STORED,
    links: [{ id: "l", label: "Enlace" }],
  };
  const shown = (caption: unknown) => {
    const slides = structuredClone(STORED) as Record<string, unknown>[];
    slides[1]!.caption = caption;
    return { ...startedFrom, slides };
  };
  const payload = (
    caption: unknown,
    sourceOf: (path: string) => string | undefined = () => "en"
  ) => nestedPayload([SLIDES, LINKS], shown(caption), startedFrom, sourceOf);

  it("sends only a container whose text changed, whole", () => {
    expect(payload("Dos")).toEqual({
      values: { slides: [STORED[0], { ...STORED[1], caption: "Dos" }] },
      claims: {},
    });
    expect(payload(null)).toEqual({ values: {}, claims: {} });
  });

  it("claims it as original only where none of its text had a source", () => {
    expect(payload("Dos", () => undefined).claims).toEqual({
      slides: { origin: "original" },
    });
    // One of its texts has one: the claim would speak for that one too.
    expect(
      payload("Dos", path => (path === "slides.0.caption" ? "en" : undefined))
        .claims
    ).toEqual({});
  });
});

describe("ontoCurrent", () => {
  const shown = {
    slides: [{ ...STORED[0], caption: "Una" }, STORED[1]],
  };
  const onto = (current: unknown) =>
    ontoCurrent([SLIDES], { slides: shown.slides, bio: "x" }, shown, {
      slides: current,
    });

  it("writes the text onto the rows there are now", () => {
    const added = { id: "c", caption: "Nueva", position: 3, points: [] };
    const moved = { ...STORED[0], position: 5 };
    expect(onto([added, STORED[1], moved])).toEqual({
      bio: "x",
      slides: [added, STORED[1], { ...moved, caption: "Una" }],
    });
  });

  it("puts back no row removed since, and no container", () => {
    expect(onto([STORED[1]])).toEqual({ bio: "x", slides: [STORED[1]] });
    expect(onto(null)).toEqual({ bio: "x" });
  });
});

describe("textPerLanguage", () => {
  it("is each language's text of the same row, wherever it stands there", () => {
    const [a, b] = STORED;
    expect(
      textPerLanguage(
        SLIDES,
        "slides.1.caption",
        {
          en: [
            { ...b, caption: "Two" },
            { ...a, caption: "One" },
          ],
          // The row is not there at all.
          fr: [{ ...a, caption: "Un" }],
          ar: null,
        },
        { slides: STORED }
      )
    ).toEqual({ en: "Two", fr: undefined, ar: undefined });
  });
});
