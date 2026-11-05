import { describe, expect, it } from "vitest";

import type { BlockDocument, NodeStyles } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { blockLooks, lookClassId } from "./block-looks";
import { compilePageCss } from "./compile-page";

const colour = (color: string): NodeStyles =>
  ({ base: { base: { color } } }) as unknown as NodeStyles;

const button = {
  name: "core/button",
  editor: {
    variations: [
      { name: "primary", label: "Primary", isDefault: true as const },
      { name: "outline", label: "Outline", styles: colour("red") },
      // An insert preset, not a look: it carries no styles.
      { name: "wide", label: "Wide", props: { width: "full" } },
    ],
  },
};

describe("a block type's looks, as the site receives them", () => {
  it("is one class per look that carries styles, bound to its block type", () => {
    expect(blockLooks([button])).toEqual([
      {
        id: lookClassId("core/button", "outline"),
        slug: "button-outline",
        label: "Outline",
        orderIndex: 0,
        blockType: "core/button",
        styles: colour("red"),
      },
    ]);
  });

  it("names a look of a type outside core by its whole type", () => {
    const hero = {
      name: "acme/hero",
      editor: { variations: [{ name: "dark", styles: colour("black") }] },
    };
    expect(blockLooks([hero])[0]?.slug).toBe("acme-hero-dark");
  });

  it("leaves out a look whose name can't be written as a class", () => {
    const odd = {
      name: "core/button",
      editor: { variations: [{ name: "Big Bold!", styles: colour("red") }] },
    };
    expect(blockLooks([odd])).toEqual([]);
  });

  it("styles a block that wears it, and a shared style still wins over it", () => {
    const [outline] = blockLooks([button]);
    if (outline === undefined) throw new Error("no look");
    const card = {
      id: "c-card",
      slug: "card",
      orderIndex: 0,
      styles: colour("blue"),
    };
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          classes: [outline.id, card.id],
        },
      ],
    } as unknown as BlockDocument;
    const { css } = compilePageCss(document, {
      breakpoints: FIXTURE_BREAKPOINTS,
      namedClasses: [card, outline],
    });
    // The population first: both rules are written.
    expect(css).toContain(".nx-c-button-outline { color: red }");
    expect(css.indexOf(".nx-c-button-outline")).toBeLessThan(
      css.indexOf(".nx-c-card")
    );
  });
});
