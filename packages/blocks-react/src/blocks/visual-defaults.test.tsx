/**
 * A core block's visual defaults are DATA, never declarations written on its root.
 *
 * An inline declaration outranks every class rule regardless of specificity or source order, so a
 * block that styles the element carrying its own `className` defeats the rules compiled from the
 * style controls it declares support for. The control still writes a value, the sheet still gains a
 * rule, and the page does not change — which is the worst shape a defect can take, because nothing
 * anywhere reports it.
 *
 * The library follows this today by convention, stated in prose block by block (`core/spacer`: "The
 * height is a style rather than a prop"). A convention with nothing enforcing it is not a control,
 * and the same convention was broken ten times over in the registry this library replaces. This is
 * the enforcement.
 *
 * `baseStyles` is where a default belongs: it compiles to the block-type tier, which the site's
 * classes, the node's own values and a consumer's stylesheet all override.
 *
 * Scoped to the ROOT because that is where the conflict is: the root carries `className`, so it is
 * the element the block's own compiled rules land on. A nested element is not exempt from the
 * principle, but it is not the measured defect and a rule reaching further would reject markup no
 * control competes with.
 *
 * ## What this does NOT cover
 *
 * Each block is drawn once, from its `example`, so only the branch that instance reaches is read.
 * A block whose root is conditional has other roots this never renders — `core/quote` returns a
 * bare `<blockquote>` when nothing is attributed and a `<figure>` otherwise, and the example
 * attributes, so the `<blockquote>` branch is unchecked here. Found by breaking that branch and
 * watching the suite stay green, which is the only way this kind of gap announces itself.
 *
 * Drawing every branch would mean enumerating prop combinations per block, and the honest state is
 * that this covers the shipped example rather than the whole render. It is stated so a green is not
 * read as more than it is.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockNode } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { coreBlocks } from "./index";

/**
 * Every core block, seen as the single shape this guard needs.
 *
 * `coreBlocks` is a union of definitions whose prop types differ, so calling `render` on the union
 * demands the INTERSECTION of every block's props, which no instance can satisfy. Each block is
 * drawn from its OWN example here, so the props always match the block they came from; this names
 * that narrow contract in one place rather than widening any block's own types.
 */
interface DrawableBlock {
  name: string;
  version: number;
  example: { props: unknown };
  render: (args: BlockRenderArgs<never>) => unknown;
}

const DRAWABLE: readonly DrawableBlock[] = coreBlocks;

function context(): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };
}

/**
 * Render one block the way a page would, from the worked instance it is required to publish.
 *
 * `example` rather than hand-written props: every definition carries one, so no block is skipped for
 * want of a fixture, and the props are the author's own rather than a guess that might miss the
 * branch that styles anything.
 */
async function rootOf(block: DrawableBlock): Promise<string> {
  const node: BlockNode = {
    id: "n1",
    type: block.name,
    version: block.version,
    props: block.example.props as Record<string, unknown>,
  };
  const args = {
    props: block.example.props,
    node,
    className: "nx-n1",
    ctx: context(),
    renderSlot: () => <span>child</span>,
  } as unknown as BlockRenderArgs<never>;
  // Awaited because several blocks are async server components: calling `render` on one returns a
  // promise of the element, and handing that straight to the renderer suspends instead of drawing.
  const drawn = await block.render(args);
  const html = renderToStaticMarkup(drawn as ReactElement);
  // The opening tag alone. A nested element's own attributes are a different question, and reading
  // the whole document here would answer it by accident.
  return html.slice(0, html.indexOf(">") + 1);
}

describe("a core block's root element", () => {
  it("covers exactly the blocks the library publishes", () => {
    // The exact SET, not a floor. A library of 12 that loses one still clears "more than 10", and
    // the dropped block then stops being checked with nothing to show for it. Naming them also
    // makes the failure say WHICH block appeared or vanished, which a count cannot.
    expect([...DRAWABLE.map(block => block.name)].sort()).toEqual([
      "core/box",
      "core/button",
      "core/collection-loop",
      "core/divider",
      "core/embed",
      "core/heading",
      "core/image",
      "core/list",
      "core/quote",
      "core/section",
      "core/spacer",
      "core/text",
    ]);
  });

  it.each(DRAWABLE.map(block => [block.name, block] as const))(
    "%s writes no inline style",
    async (_name, block) => {
      const root = await rootOf(block);
      // Asserted BEFORE the absence below, which is otherwise satisfied by absence: a block whose
      // example renders nothing, or whose opening tag this helper failed to find, yields "" and
      // passes a `not.toContain` while never having been checked at all.
      expect(root).toMatch(/^<[a-zA-Z]/);
      // The attribute, not the substring. `data-style="compact"` contains `style=` and is not an
      // inline declaration, and a guard that rejects it costs an unrelated change a red build.
      expect(root).not.toMatch(/\sstyle=/);
    }
  );

  it("would catch a block that styled its own root", async () => {
    // The positive control. Without it the assertions above pass for a library whose blocks render
    // nothing at all, or whose root tag this helper failed to find — neither of which is the
    // property under test.
    const styled: DrawableBlock = {
      ...DRAWABLE[0]!,
      render: () => <div className="nx-n1" style={{ padding: 24 }} />,
    };
    expect(await rootOf(styled)).toContain("style=");
  });
});
