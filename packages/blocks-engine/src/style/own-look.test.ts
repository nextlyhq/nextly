import { describe, expect, it } from "vitest";

import type { BlockDocument, NodeStyles } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import {
  blockDefaultsOf,
  isDefaultLook,
  isUsableNamedClass,
  namedClassesRead,
  usableNamedClasses,
  type NamedClass,
} from "./named-class";

/*
 * A block type's own look (a button's Primary) as a site's class library holds
 * it: the site's edits to the type's base, read by `blockDefaultsOf` and never
 * written as a class.
 */

const colour = (color: string): NodeStyles =>
  ({ base: { base: { color } } }) as unknown as NodeStyles;

const primary: NamedClass = {
  id: "look:core/button:primary",
  slug: "button-primary",
  orderIndex: 0,
  blockType: "core/button",
  isDefault: true,
  styles: colour("purple"),
};
const outline: NamedClass = {
  id: "look:core/button:outline",
  slug: "button-outline",
  orderIndex: 1,
  blockType: "core/button",
  styles: colour("red"),
};
const card: NamedClass = {
  id: "c-card",
  slug: "card",
  orderIndex: 2,
  styles: colour("blue"),
};

describe("which classes are a block's own look", () => {
  it("is a look marked as its type's own", () => {
    expect(isDefaultLook(primary)).toBe(true);
    expect(isDefaultLook(outline)).toBe(false);
    expect(isDefaultLook(card)).toBe(false);
  });

  it("refuses the mark on a class bound to no block type, or any mark but true", () => {
    expect(isUsableNamedClass(primary)).toBe(true);
    const { blockType: _type, ...unbound } = primary;
    expect(isUsableNamedClass(unbound)).toBe(false);
    expect(isUsableNamedClass({ ...primary, isDefault: false })).toBe(false);
    expect(isUsableNamedClass({ ...primary, isDefault: "yes" })).toBe(false);
  });
});

describe("the site's edits to its block types' own looks", () => {
  it("are each own look's styles, keyed by its type", () => {
    expect(blockDefaultsOf([card, outline, primary])).toEqual({
      "core/button": colour("purple"),
    });
  });

  it("read the first own look of a type, in library order", () => {
    const later = {
      ...primary,
      id: "look:core/button:main",
      slug: "button-main",
      orderIndex: 5,
      styles: colour("green"),
    };
    expect(blockDefaultsOf([later, primary])).toEqual({
      "core/button": colour("purple"),
    });
  });

  it("read each type's own look, even where two types' own looks share an id", () => {
    // An own look claims no id, so a shared one changes nothing it renders.
    const image = {
      ...primary,
      blockType: "core/image",
      orderIndex: 3,
      styles: colour("teal"),
    };
    expect(blockDefaultsOf([primary, image])).toEqual({
      "core/button": colour("purple"),
      "core/image": colour("teal"),
    });
  });

  it("skip an own look the engine could not use, and a library that is no list", () => {
    expect(blockDefaultsOf([{ ...primary, styles: [] }])).toEqual({});
    expect(blockDefaultsOf({ classes: [primary] })).toEqual({});
    expect(blockDefaultsOf(undefined)).toEqual({});
  });
});

describe("a block's own look in the stylesheet", () => {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/button",
        version: 1,
        props: {},
        classes: [outline.id],
      },
    ],
  } as unknown as BlockDocument;
  const compiled = (namedClasses: NamedClass[]) =>
    compilePageCss(document, {
      breakpoints: FIXTURE_BREAKPOINTS,
      namedClasses,
    });

  it("is never written as a class, and claims no name another class could use", () => {
    // The population: the button's other look is written.
    expect(usableNamedClasses([primary, outline])).toEqual([outline]);
    const { css, warnings } = compiled([primary, outline]);
    expect(css).toContain("nx-l-button-outline");
    expect(css).not.toContain("button-primary");
    expect(css).not.toContain("purple");
    // Read as the type's base edits, so not reported as a class left out.
    expect(warnings).toEqual(compiled([outline]).warnings);
    // A shared style taking the own look's name keeps it.
    const named = { ...card, slug: "button-primary", id: "c-named" };
    expect(usableNamedClasses([primary, named])).toEqual([named]);
  });

  it("reports a second own look of a type, which is never read", () => {
    const second = {
      ...primary,
      id: "look:core/button:main",
      slug: "button-main",
      orderIndex: 9,
      styles: colour("green"),
    };
    const { warnings } = compiled([primary, outline, second]);
    expect(warnings.map(each => [each.code, each.path])).toEqual([
      ["duplicate-own-look", "/classes/2"],
    ]);
    // The first one is read, the second named as left out.
    expect(blockDefaultsOf([primary, outline, second])).toEqual({
      "core/button": colour("purple"),
    });
    expect(warnings[0]?.message).toContain("look:core/button:main");
  });
});

describe("own looks and the library caps", () => {
  it("never take a worn look's place under the look cap", () => {
    // One own look and one worn look for each of 300 block types, own looks
    // first, as the code tier seeds them: every worn look is still read.
    const types = Array.from({ length: 300 }, (_, at) => `acme/block${at}`);
    const own = types.map((blockType, at) => ({
      id: `look:${blockType}:main`,
      slug: `own${at}`,
      orderIndex: at,
      blockType,
      isDefault: true as const,
      styles: {},
    }));
    const worn = types.map((blockType, at) => ({
      id: `look:${blockType}:alt`,
      slug: `worn${at}`,
      orderIndex: at,
      blockType,
      styles: colour("red"),
    }));
    const read = namedClassesRead([...own, ...worn]);
    expect(read.filter(entry => !isDefaultLook(entry))).toHaveLength(300);
    expect(read.filter(isDefaultLook)).toHaveLength(300);
    expect(usableNamedClasses([...own, ...worn])).toHaveLength(300);
  });
});
