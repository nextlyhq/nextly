/**
 * What the colour control writes, carried through the real compilers.
 *
 * `style-colour.test.ts` asserts the projection and `style-colour-panel.test.tsx`
 * asserts the wiring, and between them they establish that choosing a token
 * stores `{ $token: <identity> }`. Neither shows that the value so stored
 * RESOLVES: the page compiler turns a reference into `var(--<prefix><name>)`
 * lexically, with no lookup against the table, and the site sheet declares its
 * custom properties from a different function. The two agree only if the string
 * the control stored is the one the emitter keyed on.
 *
 * That join is the whole reason `SiteToken.id` exists, and it is the failure
 * with no symptom: a reference to a property nothing declares invalidates the
 * declaration rather than reporting, so the page renders with the style simply
 * absent. Nothing above this file could see it, because both halves are correct
 * in isolation.
 *
 * So this compiles a page and a site sheet from the SAME token set the picker
 * offered, and requires the property the page references to be one the sheet
 * declares. It is not a browser — D-05.7 asks for that and this is not it — but
 * it is the whole road from the control's output to the bytes a visitor's
 * stylesheet would contain.
 *
 * @module style-colour-roundtrip.test
 */
import {
  compilePageCss,
  compileSiteSheet,
  type BlockDocument,
  type BlockNode,
  type SiteTokenSet,
  type StyleLeaf,
  STYLE_CATALOG,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { colourTokensFor } from "./style-colour";

/** The `color` property's leaf, from the catalog rather than written here. */
const COLOR = (
  STYLE_CATALOG as unknown as readonly {
    property: string;
    shape: StyleLeaf;
  }[]
).find(entry => entry.property === "color")?.shape as StyleLeaf;

/**
 * A site whose token has been RENAMED, so identity and name differ.
 *
 * The only state in which storing the wrong one of the two has a symptom. With
 * a fixture where every id equals its name, both spellings compile to the same
 * property and this file would pass against the defect it exists to catch.
 */
const TOKENS: SiteTokenSet = {
  tokens: [
    {
      id: "color.primary",
      name: "brand.main",
      kind: "color",
      values: { light: "#3b82f6" },
    },
  ],
};

const BREAKPOINTS = { base: { id: "base", label: "Base" } } as never;

/** A one-node page whose text colour holds whatever is passed. */
function pageWith(colour: unknown): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/box",
        version: 1,
        props: {},
        styles: { base: { base: { color: colour } } },
      },
    ] as BlockNode[],
  } as BlockDocument;
}

/** Every `--custom-property` the page's CSS REFERENCES through `var()`. */
function referenced(css: string): string[] {
  return [...css.matchAll(/var\((--[a-zA-Z0-9_-]+)/g)].map(
    match => match[1] ?? ""
  );
}

/** Every `--custom-property` the site sheet DECLARES. */
function declared(css: string): string[] {
  return [...css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map(
    match => match[1] ?? ""
  );
}

describe("a token chosen in the picker resolves on the page", () => {
  const offered = colourTokensFor(COLOR, TOKENS);
  const brand = offered.find(token => token.name === "brand.main");

  it("offers the renamed token under its current name", () => {
    // The control for the fixture: if the picker did not offer this token at
    // all, every assertion below would be about a token nobody could choose.
    expect(brand).toBeDefined();
    expect(brand?.name).toBe("brand.main");
    expect(brand?.identity).toBe("color.primary");
  });

  it("references a property the site sheet declares", () => {
    expect(brand).toBeDefined();
    if (brand === undefined) return;

    // Exactly what the control commits when the preset is chosen.
    const page = compilePageCss(pageWith({ $token: brand.identity }), {
      breakpoints: BREAKPOINTS,
    });
    const sheet = compileSiteSheet({
      tokens: TOKENS,
      breakpoints: BREAKPOINTS,
    });

    const uses = referenced(page.css);
    const has = declared(sheet.css);

    // Positive controls first: an empty page or an empty sheet would satisfy
    // the subset assertion below without either compiler having done anything.
    expect(uses.length).toBeGreaterThan(0);
    expect(has.length).toBeGreaterThan(0);

    for (const property of uses) expect(has).toContain(property);
  });

  it("does NOT resolve when the name is stored instead of the identity", () => {
    // The separating case, and the defect `SiteToken.id` exists to prevent.
    // This is what a control storing the label would produce, and the failure
    // has no symptom on the page: the declaration is invalid, so the style is
    // absent and everything still renders.
    expect(brand).toBeDefined();
    if (brand === undefined) return;

    const page = compilePageCss(pageWith({ $token: brand.name }), {
      breakpoints: BREAKPOINTS,
    });
    const sheet = compileSiteSheet({
      tokens: TOKENS,
      breakpoints: BREAKPOINTS,
    });

    const uses = referenced(page.css);
    const has = declared(sheet.css);

    expect(uses.length).toBeGreaterThan(0);
    // The page asks for something the sheet never declares.
    expect(uses.some(property => !has.includes(property))).toBe(true);
  });

  it("carries a literal through unchanged", () => {
    // The other thing the control writes. Asserted so a compiler that dropped
    // every colour would not pass the token cases by emitting nothing at all.
    const page = compilePageCss(pageWith("#ff0000"), {
      breakpoints: BREAKPOINTS,
    });
    expect(page.css).toContain("#ff0000");
  });
});
