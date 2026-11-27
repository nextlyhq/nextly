/**
 * How a Fit or Fixed block's place is published: what the page compile writes
 * for the values the editor stores, under each kind of parent.
 *
 * - A page stored with the left pin Fit and Fixed used to write keeps it,
 *   exactly: nothing stored is rewritten, so the block stays on the left.
 * - Fit and Fixed now write only the block's width, which leaves its place
 *   to the parent's own alignment; Align writes the block's own
 *   self-alignment, or in a Stack's flow its inline auto margins.
 */
import {
  nodeClassName,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks/index";
import type { BlockResolver } from "./resolver";
import { resolvePageStyles } from "./styles";

const resolver: BlockResolver = {
  get: (name: string) => coreBlocks.find(block => block.name === name) as never,
};
const context = {
  breakpoints: {
    viewport: [
      { id: "base", label: "Desktop" },
      { id: "sm", label: "Mobile", maxWidth: 640 },
    ],
    container: [],
  },
};

/** A Section arranged as given, holding one Image with the values given. */
function page(
  parent: Record<string, string>,
  image: Record<string, Record<string, unknown>>
): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "section",
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        styles: { base: { base: parent } },
        slots: {
          children: [
            {
              id: "image",
              type: "core/image",
              version: 1,
              props: { src: "/globe.svg", alt: "A globe" },
              styles: { base: image },
            } as BlockNode,
          ],
        },
      } as BlockNode,
    ],
  } as BlockDocument;
}

/** The declarations the page compile writes for the Image, at Desktop. */
function imageRule(document: BlockDocument): string {
  const css = resolvePageStyles(document, undefined, context, resolver).css;
  const match = new RegExp(`\\.${nodeClassName("image")} \\{([^}]*)\\}`).exec(
    css
  );
  return match?.[1]?.trim() ?? "";
}

const CENTRED_COLUMN = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

describe("a page stored before Fit and Fixed followed the parent", () => {
  it("publishes its left pin exactly as before", () => {
    const fit = page(CENTRED_COLUMN, { base: { alignSelf: "flex-start" } });
    expect(imageRule(fit)).toBe("align-self: flex-start");
    const fixed = page(CENTRED_COLUMN, {
      base: { width: "320px", alignSelf: "flex-start" },
    });
    expect(imageRule(fixed)).toBe(
      "align-self: flex-start; width: 320px; --nx-sized-width: 1"
    );
    const grid = page({ display: "grid" }, { base: { justifySelf: "start" } });
    expect(imageRule(grid)).toBe("justify-self: start");
  });
});

describe("Fit, Fixed and Align as they are written now", () => {
  it.each([
    [
      "Fit under a flex column, the parent's place",
      CENTRED_COLUMN,
      { width: "fit-content" },
      "width: fit-content; --nx-sized-width: 1",
    ],
    [
      "Fixed under a flex column, Align Right",
      CENTRED_COLUMN,
      { width: "300px", alignSelf: "flex-end" },
      "align-self: flex-end; width: 300px; --nx-sized-width: 1",
    ],
    [
      "Fit in a Grid, Align Center",
      { display: "grid" },
      { width: "fit-content", justifySelf: "center" },
      "justify-self: center; width: fit-content; --nx-sized-width: 1",
    ],
    [
      "Fit in a Stack's flow, Align Center",
      {},
      {
        width: "fit-content",
        margin: { inlineStart: "auto", inlineEnd: "auto" },
      },
      "margin-inline-end: auto; margin-inline-start: auto; width: fit-content; --nx-sized-width: 1",
    ],
  ] as const)("%s", (_, parent, values, expected) => {
    expect(
      imageRule(page(parent as Record<string, string>, { base: values }))
    ).toBe(expected);
  });

  it("writes an Align set at Mobile at Mobile only", () => {
    const document = page(CENTRED_COLUMN, {
      base: { width: "fit-content" },
      sm: { alignSelf: "flex-end" },
    });
    // Desktop's rule holds no place: the Section centres the block there.
    expect(imageRule(document)).toBe("width: fit-content; --nx-sized-width: 1");
    const css = resolvePageStyles(document, undefined, context, resolver).css;
    const mobile =
      /@media \(max-width: 640px\) \{([^@]*)\}/.exec(css)?.[1] ?? "";
    expect(mobile).toContain(
      `.${nodeClassName("image")} { align-self: flex-end }`
    );
  });
});
