import {
  blockLooks,
  styleOrigin,
  type BlockDocument,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { BlockResolver } from "../resolver";
import { resolvePageStylesWithTrace } from "../styles";

import { coreBlocks } from "./index";

/*
 * The order a block's look stands in, under the Classic spacing mode, which
 * swaps in the frozen block bases: the block's own base, then its look, then a
 * shared style it wears, then its own values. Read off the compiled trace by
 * the engine's own cascade reader, one tier taken away at a time.
 */
const resolver: BlockResolver = {
  get: (name: string) => coreBlocks.find(block => block.name === name) as never,
};
const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};
const colour = (color: string): NodeStyles =>
  ({ base: { base: { color } } }) as unknown as NodeStyles;

const outline = blockLooks(coreBlocks).find(
  look => look.id === "look:core/button:outline"
) as NamedClass;
const cta: NamedClass = {
  id: "c-cta",
  slug: "cta",
  orderIndex: 0,
  styles: colour("#00aa00"),
};

/** Which tier the button's colour comes from, in Classic spacing. */
function colourFrom(
  classes: readonly NamedClass[],
  own: NodeStyles | undefined
): string | undefined {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/button",
        version: 1,
        props: { label: "Go" },
        classes: classes.map(each => each.id),
        ...(own === undefined ? {} : { styles: own }),
      },
    ],
  } as unknown as BlockDocument;
  const { trace } = resolvePageStylesWithTrace(
    document,
    undefined,
    {
      breakpoints: BREAKPOINTS,
      spacingMode: "classic",
      namedClasses: [...classes],
    },
    resolver,
    false,
    { trace: true }
  );
  const origin = styleOrigin(
    trace ?? [],
    {
      nodeId: "n1",
      blockType: "core/button",
      classIds: classes.map(each => each.id),
    },
    { property: "color", state: "base", breakpoints: ["base"] }
  )?.origin;
  if (origin === undefined) return undefined;
  return origin.kind === "class" ? origin.id : origin.kind;
}

describe("a look's place in the cascade, in Classic spacing", () => {
  it("is above the frozen base and below a shared style and the block's own value", () => {
    // The population: the look sets the colour the test follows.
    expect(outline.styles).toMatchObject({ base: { base: { color: {} } } });
    expect(colourFrom([outline, cta], colour("#aa0000"))).toBe("node");
    expect(colourFrom([outline, cta], undefined)).toBe("c-cta");
    // Listed after the shared style, the look still comes first.
    expect(colourFrom([cta, outline], undefined)).toBe("c-cta");
    expect(colourFrom([outline], undefined)).toBe(outline.id);
    expect(colourFrom([], undefined)).toBe("blockType");
  });
});
