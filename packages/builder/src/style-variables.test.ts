/**
 * What a field offers from the site's variables: which typed word names one,
 * the hint that says one may be chosen, and the sample a list draws.
 *
 * The leaves come from `STYLE_CATALOG` rather than being written here, so a
 * catalog change to which token kinds a property takes reaches these tests.
 *
 * @module style-variables.test
 */
import {
  STYLE_CATALOG,
  type SiteTokenSet,
  type StyleLeaf,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { variablesFor } from "./style-colour";
import {
  lengthInPx,
  tokenForTypedName,
  variableSample,
} from "./style-variables";

interface CatalogEntry {
  readonly property: string;
  readonly shape: Record<string, unknown>;
}

const shapeOf = (property: string): Record<string, unknown> => {
  const found = (STYLE_CATALOG as unknown as readonly CatalogEntry[]).find(
    candidate => candidate.property === property
  );
  if (found === undefined) throw new Error(`no catalog entry for ${property}`);
  return found.shape;
};

const FONT_SIZE = shapeOf("fontSize") as unknown as StyleLeaf;
const COLOR = shapeOf("color") as unknown as StyleLeaf;
const BOX_SHADOW = shapeOf("boxShadow") as unknown as StyleLeaf;
const OPACITY = shapeOf("opacity") as unknown as StyleLeaf;
/** The length arm of `lineHeight`, where a line-height variable is taken. */
const LINE_HEIGHT = (shapeOf("lineHeight").of as StyleLeaf[])[1] as StyleLeaf;
const PADDING_START = (shapeOf("padding").sides as Record<string, StyleLeaf>)
  .blockStart as StyleLeaf;
const GAP = shapeOf("gap") as unknown as StyleLeaf;
/** The single-radius arm of `borderRadius`. */
const RADIUS = (shapeOf("borderRadius").of as StyleLeaf[])[0] as StyleLeaf;
const WIDTH = shapeOf("width") as unknown as StyleLeaf;

/**
 * A type size and its line height under ONE name, as Design adds them, so a
 * matcher that ignores which property a type-scale variable is made for
 * answers ambiguously, or with the wrong one.
 */
const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "font-size.display", kind: "dimension", values: { light: "48px" } },
    {
      name: "line-height.display",
      kind: "dimension",
      values: { light: "56px" },
    },
    { name: "space.sm", kind: "dimension", values: { light: "8px" } },
    {
      id: "space.lg",
      name: "spacing.large",
      label: "Roomy",
      kind: "dimension",
      values: { light: "2rem" },
    },
    { name: "radius.card", kind: "dimension", values: { light: "12px" } },
    { name: "color.ink", kind: "color", values: { light: "#111111" } },
    {
      name: "shadow.soft",
      kind: "shadow",
      values: { light: "0 1px 2px #0003" },
    },
  ],
};

describe("a typed variable name", () => {
  it("picks the type size in a font size field, not its line height", () => {
    expect(tokenForTypedName(FONT_SIZE, TOKENS, "Display")).toBe(
      "font-size.display"
    );
  });

  it("picks the line height of that name in a line height field", () => {
    expect(tokenForTypedName(LINE_HEIGHT, TOKENS, "Display")).toBe(
      "line-height.display"
    );
  });

  it("matches the name whatever its case, and around spaces", () => {
    expect(tokenForTypedName(FONT_SIZE, TOKENS, "  dISPLAY ")).toBe(
      "font-size.display"
    );
  });

  it("matches a variable's code name too", () => {
    expect(tokenForTypedName(PADDING_START, TOKENS, "space.sm")).toBe(
      "space.sm"
    );
  });

  it("stores a renamed variable by its identity, matched by its label", () => {
    // The label is what the author reads, the identity what a reference must
    // hold: matching "Roomy" and storing the label or the name would compile to
    // a custom property nothing declares.
    expect(tokenForTypedName(PADDING_START, TOKENS, "roomy")).toBe("space.lg");
  });

  it("names a colour variable in a colour field", () => {
    // The engine's default set has `color.text`, read as "Text".
    expect(tokenForTypedName(COLOR, TOKENS, "Text")).toBe("color.text");
    expect(tokenForTypedName(COLOR, TOKENS, "ink")).toBe("color.ink");
  });

  it("names nothing for a word no variable of the leaf's kinds carries", () => {
    // A colour variable's name typed into a length is still a literal, which
    // the catalog then refuses in its own words.
    expect(tokenForTypedName(FONT_SIZE, TOKENS, "Ink")).toBeUndefined();
    expect(tokenForTypedName(FONT_SIZE, TOKENS, "Huge")).toBeUndefined();
    expect(tokenForTypedName(FONT_SIZE, TOKENS, "16px")).toBeUndefined();
    expect(tokenForTypedName(FONT_SIZE, TOKENS, "")).toBeUndefined();
  });

  it("names nothing when the host supplied no variables", () => {
    expect(tokenForTypedName(FONT_SIZE, undefined, "Display")).toBeUndefined();
  });
});

describe("what a field's list offers: its own family", () => {
  const names = (leaf: StyleLeaf): string[] =>
    variablesFor(leaf, TOKENS).map(token => token.name);

  it("offers a font size the type sizes alone", () => {
    expect(names(FONT_SIZE)).toEqual(["font-size.display"]);
  });

  it("offers a line height the line heights alone", () => {
    expect(names(LINE_HEIGHT)).toEqual(["line-height.display"]);
  });

  it("offers margin, padding and gap the spacing steps alone", () => {
    // `space.4` is the engine's own, so a site has it without defining it.
    const spacing = ["space.4", "space.sm", "spacing.large"];
    expect(names(PADDING_START)).toEqual(spacing);
    expect(names(GAP)).toEqual(spacing);
  });

  it("offers a radius the radii alone", () => {
    expect(names(RADIUS)).toEqual(["radius.card"]);
  });

  it("offers any other length every length", () => {
    expect(names(WIDTH)).toEqual([
      "content.width",
      "space.4",
      "font-size.display",
      "line-height.display",
      "space.sm",
      "spacing.large",
      "radius.card",
    ]);
  });

  it("offers a field nothing where the site has none of its kinds", () => {
    // No number variable anywhere, the engine's defaults included.
    expect(names(OPACITY)).toEqual([]);
  });
});

describe("a variable's sample", () => {
  const sample = (name: string) => {
    const found = [
      ...variablesFor(FONT_SIZE, TOKENS),
      ...variablesFor(WIDTH, TOKENS),
      ...variablesFor(BOX_SHADOW, TOKENS),
    ].find(token => token.name === name);
    if (found === undefined) throw new Error(`not offered: ${name}`);
    return variableSample(found);
  };

  it("draws a type size as its name at that size, capped to fit a row", () => {
    expect(sample("font-size.display")).toEqual({ kind: "type", px: 28 });
  });

  it("draws a length as a bar as wide as it is, capped", () => {
    expect(sample("space.sm")).toEqual({ kind: "bar", px: 8 });
    // 2rem is 32px at the browser's default root size.
    expect(sample("spacing.large")).toEqual({ kind: "bar", px: 32 });
    // The engine's default content width, 72rem, is far wider than a row.
    expect(sample("content.width")).toEqual({ kind: "bar", px: 64 });
  });

  it("draws a shadow as itself", () => {
    expect(sample("shadow.soft")).toEqual({
      kind: "shadow",
      value: "0 1px 2px #0003",
    });
  });

  it("reads px, rem and em, and nothing it cannot measure", () => {
    expect(lengthInPx("12px")).toBe(12);
    expect(lengthInPx("1.5rem")).toBe(24);
    expect(lengthInPx("-0.5em")).toBe(-8);
    expect(lengthInPx("0")).toBe(0);
    expect(lengthInPx("50%")).toBeUndefined();
    expect(lengthInPx("clamp(1rem, 2vw, 3rem)")).toBeUndefined();
  });
});
