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
  type UnionShape,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { foldedLeaf, variablesFor } from "./style-colour";
import {
  lengthInPx,
  tokenForTypedName,
  variableValueText,
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
const MARGIN_START = (shapeOf("margin").sides as Record<string, StyleLeaf>)
  .blockStart as StyleLeaf;
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

  // Judged by family rather than by the whole list, since the engine's own
  // defaults (`space.4` and the rest) come along with every site.
  const SPACING = /^(space|spacing|gap)\./;

  it("offers margin, padding and gap the spacing steps alone", () => {
    for (const leaf of [PADDING_START, GAP]) {
      expect(names(leaf)).toEqual(
        expect.arrayContaining(["space.4", "space.sm", "spacing.large"])
      );
      expect(names(leaf).every(name => SPACING.test(name))).toBe(true);
    }
  });

  it("offers a radius the radii alone", () => {
    expect(names(RADIUS)).toContain("radius.card");
    expect(names(RADIUS).every(name => name.startsWith("radius."))).toBe(true);
  });

  it("offers any other length every length", () => {
    expect(names(WIDTH)).toEqual(
      expect.arrayContaining([
        "content.width",
        "space.4",
        "font-size.display",
        "line-height.display",
        "space.sm",
        "spacing.large",
        "radius.card",
      ])
    );
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

describe("what a field offers: only what it accepts", () => {
  /**
   * Each variable's KIND fits the fields below; what separates them is the
   * VALUE: padding refuses a negative length, margin takes one, and opacity
   * stops at 1. A filter by kind and family alone offers all of them.
   */
  const VALUES: SiteTokenSet = {
    tokens: [
      { name: "space.pull", kind: "dimension", values: { light: "-8px" } },
      {
        name: "space.fluid",
        kind: "dimension",
        values: { light: "calc(1rem + 2vw)" },
      },
      { name: "number.half", kind: "number", values: { light: "0.5" } },
      { name: "number.lots", kind: "number", values: { light: "1.5" } },
    ],
  };
  const offered = (leaf: StyleLeaf): string[] =>
    variablesFor(leaf, VALUES).map(token => token.name);

  it("offers a negative length to margin and not to padding", () => {
    expect(offered(MARGIN_START)).toContain("space.pull");
    expect(offered(PADDING_START)).not.toContain("space.pull");
  });

  it("offers opacity only numbers it accepts", () => {
    expect(offered(OPACITY)).toContain("number.half");
    expect(offered(OPACITY)).not.toContain("number.lots");
  });

  it("keeps a value it cannot judge here, such as calc()", () => {
    expect(offered(PADDING_START)).toContain("space.fluid");
  });

  it("does not take a refused variable's name as typed", () => {
    expect(tokenForTypedName(PADDING_START, VALUES, "pull")).toBeUndefined();
    expect(tokenForTypedName(MARGIN_START, VALUES, "pull")).toBe("space.pull");
  });
});

describe("a fluid variable", () => {
  const FLUID: SiteTokenSet = {
    tokens: [
      {
        name: "space.gutter-fluid",
        kind: "dimension",
        values: { light: "clamp(1rem, 4vw, 3rem)" },
      },
    ],
  };
  const fluid = () => {
    const found = variablesFor(WIDTH, FLUID).find(
      token => token.name === "space.gutter-fluid"
    );
    if (found === undefined) throw new Error("not offered");
    return found;
  };

  it("is drawn as a fluid bar, having no one length to scale to", () => {
    expect(variableSample(fluid())).toEqual({ kind: "fluid" });
  });

  it("reads 'Fluid' in a list, where its whole value would not fit", () => {
    expect(variableValueText(fluid())).toBe("Fluid");
    const [one] = variablesFor(WIDTH, TOKENS).filter(
      token => token.name === "space.sm"
    );
    expect(one === undefined ? "" : variableValueText(one)).toBe("8px");
  });
});

describe("a folded field judges each variable by the form it fits", () => {
  // The two forms of each folded property, as the catalog declares them.
  const arms = (property: string): StyleLeaf[] =>
    shapeOf(property).of as StyleLeaf[];
  // The catalog's union for a folded property, as the inspector passes it.
  const unionOf = (property: string): UnionShape => {
    const shape = STYLE_CATALOG.find(
      entry => entry.property === property
    )?.shape;
    if (shape?.kind !== "union") throw new Error(`${property} is no union`);
    return shape;
  };
  const VALUES: SiteTokenSet = {
    tokens: [
      { name: "weight.heavy", kind: "number", values: { light: "700" } },
      { name: "weight.over", kind: "number", values: { light: "1500" } },
      { name: "weight.bold", kind: "fontWeight", values: { light: "bold" } },
      {
        name: "weight.lighter",
        kind: "fontWeight",
        values: { light: "lighter" },
      },
      { name: "weight.wrong", kind: "fontWeight", values: { light: "heavy" } },
      {
        name: "line-height.loose",
        kind: "dimension",
        values: { light: "32px" },
      },
      {
        name: "line-height.under",
        kind: "dimension",
        values: { light: "-8px" },
      },
    ],
  };
  const offered = (leaf: StyleLeaf): string[] =>
    variablesFor(leaf, VALUES).map(token => token.name);

  it("holds a font weight's number variable to the number form's 1 to 1000", () => {
    // Unset, the field draws the keyword form; the number form still judges.
    const weight = foldedLeaf(arms("fontWeight"));
    expect(offered(weight)).toContain("weight.heavy");
    expect(offered(weight)).not.toContain("weight.over");
  });

  it("offers a font weight variable holding a keyword, by the form its value takes", () => {
    // A font weight variable may hold "bold" as well as 700: the form that
    // judges it is the one the engine picks for its value, not one guessed
    // from its kind, which held every weight to the number form.
    const weight = foldedLeaf(arms("fontWeight"), unionOf("fontWeight"));
    expect(offered(weight)).toContain("weight.bold");
    expect(offered(weight)).toContain("weight.lighter");
    expect(offered(weight)).toContain("weight.heavy");
    // A keyword neither form takes is still refused.
    expect(offered(weight)).not.toContain("weight.wrong");
  });

  it("holds a line height's length variable to the length form", () => {
    const lineHeight = foldedLeaf(arms("lineHeight"));
    expect(offered(lineHeight)).toContain("line-height.loose");
    expect(offered(lineHeight)).not.toContain("line-height.under");
  });
});

describe("what reads as Fluid", () => {
  const SET: SiteTokenSet = {
    tokens: [
      {
        name: "space.gutter-fluid",
        kind: "dimension",
        values: { light: "clamp(1rem, 4vw, 3rem)" },
      },
      {
        name: "space.sum",
        kind: "dimension",
        values: { light: "calc(1rem + 2px)" },
      },
      {
        name: "shadow.lift",
        kind: "shadow",
        values: { light: "0 2px 4px rgba(0, 0, 0, 0.2)" },
      },
    ],
  };
  const find = (leaf: StyleLeaf, name: string) => {
    const found = variablesFor(leaf, SET).find(token => token.name === name);
    if (found === undefined) throw new Error(`not offered: ${name}`);
    return found;
  };

  it("is a length that changes with the viewport", () => {
    expect(variableValueText(find(WIDTH, "space.gutter-fluid"))).toBe("Fluid");
  });

  it("is not a fixed length through calc(), which reads as itself", () => {
    const sum = find(WIDTH, "space.sum");
    expect(variableValueText(sum)).toBe("calc(1rem + 2px)");
    expect(variableSample(sum)).toEqual({ kind: "none" });
  });

  it("is not a shadow, which reads and draws as itself", () => {
    const lift = find(BOX_SHADOW, "shadow.lift");
    expect(variableValueText(lift)).toBe("0 2px 4px rgba(0, 0, 0, 0.2)");
    expect(variableSample(lift)).toEqual({
      kind: "shadow",
      value: "0 2px 4px rgba(0, 0, 0, 0.2)",
    });
  });
});
