import {
  styleOrigin,
  type BlockDocument,
  type NamedClass,
  type NodeStyles,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { BlockResolver } from "../resolver";
import { sharedStyleInputsId } from "../shared-style-inputs";
import { resolvePageStylesWithTrace } from "../styles";

import { coreBlocks } from "./index";

/*
 * Where the site's edit of a block type's own look stands, under the Classic
 * spacing mode, which swaps in the frozen block bases: over the base, under a
 * shared style and the block's own values. Read off the compiled trace by the
 * engine's own cascade reader.
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
const cta: NamedClass = {
  id: "c-cta",
  slug: "cta",
  orderIndex: 0,
  styles: colour("#00aa00"),
};
const primaryEdit = { "core/button": colour("#aa00aa") };

function compiled(
  extra: Partial<StyleCompileContext>,
  classes: readonly NamedClass[],
  own?: NodeStyles
) {
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
  return resolvePageStylesWithTrace(
    document,
    undefined,
    {
      breakpoints: BREAKPOINTS,
      spacingMode: "classic",
      namedClasses: [...classes],
      ...extra,
    },
    resolver,
    false,
    { trace: true }
  );
}

/** The tier the button's value for one property comes from, and its value. */
function from(
  property: string,
  extra: Partial<StyleCompileContext>,
  classes: readonly NamedClass[],
  own?: NodeStyles
): { tier: string; value: string } | undefined {
  const { trace } = compiled(extra, classes, own);
  const entry = styleOrigin(
    trace ?? [],
    {
      nodeId: "n1",
      blockType: "core/button",
      classIds: classes.map(each => each.id),
    },
    { property, state: "base", breakpoints: ["base"] }
  );
  if (entry === undefined) return undefined;
  const tier =
    entry.origin.kind === "class" ? entry.origin.id : entry.origin.kind;
  return { tier, value: entry.value };
}

describe("the site's edit of a block's own look, in Classic spacing", () => {
  const edited = { blockDefaults: primaryEdit };

  it("is over the frozen base and under a shared style and the block's own value", () => {
    expect(from("color", edited, [cta], colour("#aa0000"))?.tier).toBe("node");
    expect(from("color", edited, [cta])?.tier).toBe("c-cta");
    expect(from("color", edited, [])).toEqual({
      tier: "blockType",
      value: "#aa00aa",
    });
    // The control: without the edit, the frozen base's own colour shows.
    const unedited = from("color", {}, []);
    expect(unedited?.tier).toBe("blockType");
    expect(unedited?.value).not.toBe("#aa00aa");
  });

  it("keeps every default value the site did not change", () => {
    expect(from("display", edited, [])).toEqual(from("display", {}, []));
    expect(from("display", {}, [])?.value).toBe("inline-block");
  });

  it("moves the stamp of a stored sheet, and leaves it where nothing is edited", () => {
    const base = { breakpoints: BREAKPOINTS };
    expect(
      sharedStyleInputsId({ ...base, blockDefaults: primaryEdit })
    ).not.toBe(sharedStyleInputsId(base));
    expect(sharedStyleInputsId({ ...base, blockDefaults: {} })).toBe(
      sharedStyleInputsId(base)
    );
  });
});
