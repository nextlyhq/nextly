/**
 * Every block the library ships renders, from the props it advertises.
 *
 * ## The gap this closes
 *
 * `base-styles.test.tsx` walks every block's DECLARATIONS and asserts what
 * reaches the compiled stylesheet. Nothing walked every block's MARKUP. A block
 * whose renderer returned nothing, or threw on the props its own palette entry
 * shows, would put a hole in a page and no suite would say so — the whole
 * library had to be opened in a browser to find out.
 *
 * `primitives.test.tsx` renders nine of them individually and asserts exact
 * markup, which is the stronger claim where it is made. This is the WEAKER claim
 * made about ALL of them: a block added to `coreBlocks` is covered the moment it
 * is registered, rather than when somebody remembers to write its case.
 *
 * ## Built from the definitions, never from a list here
 *
 * Each case takes the block's OWN `example.props` — the same object the inserter
 * shows an author — so this file cannot describe a working block differently
 * from the palette, and a block whose example stops producing markup fails by
 * name.
 *
 * ## Why it calls `render` rather than going through `PageRenderer`
 *
 * `core/image`, `core/button` and `core/collection-loop` are async, and
 * `renderToStaticMarkup` cannot render an async component: driven through
 * `PageRenderer` all three emit an EMPTY page body, which is the arrangement the
 * library's own `primitives.test.tsx` avoids by awaiting the render function
 * directly. Doing the same here is what makes the three async blocks testable at
 * all rather than silently exempt.
 *
 * ## What it does NOT claim
 *
 * That a block looks right. A block can render perfectly and still look broken
 * — a grid whose gutter is zero, a control whose border has no width — and jsdom
 * sees none of that. This asserts the weaker thing nothing asserted at all: that
 * the block produces its own element. The looking is what the playground's
 * `seed/kitchen-sink.ts` page is for.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AnyBlockDefinition, BlockNode } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { coreBlocks } from "./index";

const BLOCKS = coreBlocks as AnyBlockDefinition[];

/**
 * The class this harness passes in, and looks for in the output.
 *
 * A marker of its own rather than the block's real type class, because the real
 * one also appears in a compiled stylesheet — asserting it against a whole page
 * is satisfied by CSS for a block that emitted nothing. Nothing else can put
 * this string in the markup, so finding it means the block rendered ITS element.
 */
const MARKER = "nx-every-block-marker";

const NODE: BlockNode = { id: "n1", type: "core/text", version: 1, props: {} };

function context(): PageContext {
  return {
    entry: null,
    // A reader that answers with nothing. `core/collection-loop` queries it, and
    // a loop over an empty collection still renders its own container — which is
    // the element this asserts, rather than the rows it would hold.
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };
}

function args(props: Record<string, unknown>): BlockRenderArgs<never> {
  return {
    props,
    node: NODE,
    className: MARKER,
    partClass: () => "",
    ctx: context(),
    // A container renders an empty box, which still emits its own element. The
    // children a slot would hold are not what this case is about.
    renderSlot: () => null,
  } as unknown as BlockRenderArgs<never>;
}

/** What one block renders from its own advertised props. */
async function renderOf(block: AnyBlockDefinition): Promise<string> {
  const element = (await block.render(
    args({ ...(block.example?.props ?? {}) }) as never
  )) as ReactElement | null;
  return element === null ? "" : renderToStaticMarkup(element);
}

describe("every block in the library", () => {
  it("is a population this file actually inspects", () => {
    /*
     * The control. Every case below is `it.each` over `coreBlocks`, so a
     * `coreBlocks` that failed to load — a broken barrel, a renamed export —
     * would register no cases and the file would pass having rendered nothing.
     */
    expect(BLOCKS.length).toBeGreaterThan(15);
    expect(BLOCKS.map(block => block.name)).toContain("core/heading");
  });

  it("advertises example props for every block", () => {
    /*
     * The cases below take `example.props` and fall back to `{}`. A block that
     * lost its example would then be rendered with NO props and could pass by
     * rendering an empty container — so the examples are asserted to exist
     * rather than relied on quietly.
     *
     * `core/spacer` and `core/divider` legitimately declare an empty example:
     * they take no props. Presence is what is required, not contents.
     */
    const without = BLOCKS.filter(block => block.example === undefined).map(
      block => block.name
    );

    expect(
      without,
      `${without.join(", ")} advertise no example props, so the palette shows ` +
        `an author nothing and the cases below would render them bare.`
    ).toEqual([]);
  });

  it.each(BLOCKS.map(block => [block.name, block] as const))(
    "%s renders its own element from its example props",
    async (name, block) => {
      const markup = await renderOf(block);

      expect(
        markup,
        `${name} rendered nothing from the props its own palette entry ` +
          `advertises, so an author who inserts it gets a hole in the page.`
      ).toContain(MARKER);
    }
  );
});
