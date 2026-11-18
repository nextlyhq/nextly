/**
 * Text styles: named classes with the text role, holding typography only,
 * written after block styles and before shared styles.
 *
 * Asserted against the emitted stylesheet and the class list a renderer is
 * handed, as the class tier's own tests are: at one specificity the order of
 * the rules is the whole definition of which value an author sees.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, NodeStyles } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import { compileSiteSheet } from "./site-sheet";
import { resolveSiteTokens } from "./site-tokens";
import type { NamedClass } from "./named-class";
import {
  classNameOf,
  isTextStyle,
  isUsableNamedClass,
  nonTypographyProperties,
  orderedNamedClasses,
} from "./named-class";

const styles = (values: Record<string, unknown>): NodeStyles =>
  ({ base: { base: values } }) as unknown as NodeStyles;

const doc = (node: Record<string, unknown>): BlockDocument =>
  ({
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "n1", type: "core/box", version: 1, props: {}, ...node }],
  }) as unknown as BlockDocument;

const compile = (document: BlockDocument, namedClasses: NamedClass[]) =>
  compilePageCss(document, {
    breakpoints: FIXTURE_BREAKPOINTS,
    namedClasses,
    blockBases: {},
  } as never);

/** Where a selector sits in the stylesheet, refusing one that is not there. */
const at = (css: string, needle: string): number => {
  const index = css.indexOf(needle);
  expect(index, `"${needle}" is not in the stylesheet`).toBeGreaterThan(-1);
  return index;
};

const eyebrow: NamedClass = {
  id: "t1",
  slug: "eyebrow",
  label: "Eyebrow",
  orderIndex: 9,
  role: "text",
  styles: styles({
    fontSize: "12px",
    lineHeight: 1.4,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  }),
};
const card: NamedClass = {
  id: "c1",
  slug: "card",
  orderIndex: 0,
  styles: styles({ color: "blue" }),
};
const outline: NamedClass = {
  id: "look:core/box:outline",
  slug: "box-outline",
  orderIndex: 12,
  blockType: "core/box",
  styles: styles({ fontSize: "20px" }),
};

describe("a text style is its own kind of named class", () => {
  it("is told apart from a block style and a shared style", () => {
    expect(isTextStyle(eyebrow)).toBe(true);
    expect(isTextStyle(card)).toBe(false);
    expect(isTextStyle(outline)).toBe(false);
  });

  it("is written under a name of its own, never a shared style's", () => {
    expect(classNameOf(eyebrow)).toBe("nx-t-eyebrow");
    expect(classNameOf(card)).toBe("nx-c-card");
  });

  it("holds typography only: any other property makes it unusable", () => {
    expect(isUsableNamedClass(eyebrow)).toBe(true);
    const coloured = {
      ...eyebrow,
      styles: styles({ fontSize: "12px", color: "red" }),
    };
    expect(nonTypographyProperties(coloured.styles)).toEqual(["color"]);
    expect(isUsableNamedClass(coloured)).toBe(false);
    // At any breakpoint and in any state, not only the widest one at rest.
    const hoverPadding = {
      ...eyebrow,
      styles: {
        base: { base: { fontSize: "12px" } },
        hover: { mobile: { paddingTop: "4px" } },
      } as unknown as NodeStyles,
    };
    expect(isUsableNamedClass(hoverPadding)).toBe(false);
  });

  it("is never bound to a block type, and has no other role", () => {
    expect(isUsableNamedClass({ ...eyebrow, blockType: "core/box" })).toBe(
      false
    );
    expect(
      isUsableNamedClass({ ...card, role: "colour" } as unknown as NamedClass)
    ).toBe(false);
  });
});

describe("the text style tier sits between block styles and shared styles", () => {
  it("orders block styles, then text styles, then shared styles, whatever their positions", () => {
    expect(
      orderedNamedClasses([card, eyebrow, outline]).map(cls => cls.id)
    ).toEqual([outline.id, eyebrow.id, card.id]);
  });

  it("writes its rule after the block style's and before the shared style's", () => {
    const { css } = compile(
      doc({ classes: [outline.id, eyebrow.id, card.id] }),
      [card, eyebrow, outline]
    );
    expect(at(css, ".nx-l-box-outline")).toBeLessThan(at(css, ".nx-t-eyebrow"));
    expect(at(css, ".nx-t-eyebrow")).toBeLessThan(at(css, ".nx-c-card"));
  });

  it("puts the text style's class on a block wearing it", () => {
    const { css, classes } = compile(doc({ classes: [eyebrow.id] }), [eyebrow]);
    expect(css).toMatch(
      /\.nx-t-eyebrow[^{]*\{[^}]*text-transform:\s*uppercase/
    );
    expect(classes.get("n1")?.split(" ")).toContain("nx-t-eyebrow");
  });

  it("writes no rule for a text style holding a property beyond typography", () => {
    const coloured = {
      ...eyebrow,
      styles: styles({ fontSize: "12px", color: "red" }),
    };
    const { css, classes } = compile(doc({ classes: [eyebrow.id] }), [
      coloured,
    ]);
    expect(css).not.toContain("nx-t-eyebrow");
    expect(classes.get("n1")?.split(" ") ?? []).not.toContain("nx-t-eyebrow");
  });

  it("leaves a library with no text styles as it was", () => {
    const before = compile(doc({ classes: [card.id] }), [card]);
    expect(before.css).not.toContain("nx-t-");
  });
});

describe("a text style built on a variable", () => {
  const bodyOn = (size: string): string =>
    compileSiteSheet(
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        tokens: resolveSiteTokens({
          tokens: [
            {
              name: "font-size.small",
              kind: "dimension",
              values: { light: size },
            },
          ],
        }),
      },
      {}
    ).css;

  it("changes with the variable, with no write to the text style", () => {
    const small: NamedClass = {
      ...eyebrow,
      styles: styles({ fontSize: { $token: "font-size.small" } }),
    };
    const { css } = compile(doc({ classes: [small.id] }), [small]);
    // The block's rule reads the variable, so it is the same rule whatever
    // the variable holds...
    expect(css).toMatch(
      /\.nx-t-eyebrow[^{]*\{[^}]*font-size: var\(--site-font-size-small\)/
    );
    // ...and changing the type size changes what that rule draws.
    expect(bodyOn("12px")).toMatch(/--site-font-size-small:\s*12px/);
    expect(bodyOn("14px")).toMatch(/--site-font-size-small:\s*14px/);
  });
});

describe("the typography check is bounded", () => {
  /** A map of `count` distinct properties that counts how many it is asked about. */
  const counted = (count: number) => {
    const values: Record<string, string> = {};
    for (let index = 0; index < count; index += 1) {
      values[`notTypography${index}`] = "1px";
    }
    let reads = 0;
    const proxy = new Proxy(values, {
      getOwnPropertyDescriptor(target, key) {
        reads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    return { proxy, reads: () => reads };
  };

  it("stops at the first property beyond typography when asked whether there is one", () => {
    const map = counted(10_000);
    const found = nonTypographyProperties({ base: { base: map.proxy } }, 1);
    expect(found).toEqual(["notTypography0"]);
    // A walk that read every key first would ask about all 10,000.
    expect(map.reads()).toBeLessThan(10);
  });

  it("decides a text style unusable without reading every bad property", () => {
    const map = counted(10_000);
    expect(
      isUsableNamedClass({
        ...eyebrow,
        styles: { base: { base: map.proxy } } as unknown as NodeStyles,
      })
    ).toBe(false);
    expect(map.reads()).toBeLessThan(10);
  });
});
