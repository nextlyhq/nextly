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
import { describe, expect, it } from "vitest";

import type { BlockNode } from "@nextlyhq/blocks-engine";
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";

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

/** The class a page compiles a node's own rules onto, handed to every render below. */
const BLOCK_CLASS = "nx-n1";

function context(): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };
}

/**
 * The element a block puts its own `className` on, found in the tree it returns.
 *
 * The RENDERED element rather than serialized markup, and the element carrying the CLASS rather than
 * the first opening tag. Both matter:
 *
 * - A block may wrap its content, so the outermost tag is not necessarily the one the compiled rules
 *   land on. Reading the first tag would inspect a wrapper and leave the conflicting declaration on
 *   the classed descendant unexamined.
 * - `style` is read as a PROP, so nothing depends on how React serializes it. Matching text in an
 *   opening tag cannot tell a real `style` attribute from `title="use style=compact"` or from a class
 *   token containing the same characters, and a guard that rejects those costs an unrelated change a
 *   red build.
 *
 * Returns every classed element, not the first. A block placing the class twice is malformed in a way
 * worth failing on rather than silently reading one of them.
 */
function classedElements(node: ReactNode, className: string): ReactElement[] {
  const found: ReactElement[] = [];
  const walk = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      for (const child of current) walk(child);
      return;
    }
    if (!isValidElement(current)) return;
    const props = current.props as {
      className?: unknown;
      children?: ReactNode;
    };
    if (
      typeof props.className === "string" &&
      props.className.split(/\s+/).includes(className)
    ) {
      found.push(current);
    }
    walk(props.children);
  };
  walk(node);
  return found;
}

/**
 * Render one block the way a page would, from the worked instance it is required to publish.
 *
 * `example` rather than hand-written props: every definition carries one, so no block is skipped for
 * want of a fixture, and the props are the author's own rather than a guess that might miss the
 * branch that styles anything.
 */
async function drawnBy(block: DrawableBlock): Promise<ReactNode> {
  const node: BlockNode = {
    id: "n1",
    type: block.name,
    version: block.version,
    props: block.example.props as Record<string, unknown>,
  };
  const args = {
    props: block.example.props,
    node,
    className: BLOCK_CLASS,
    ctx: context(),
    renderSlot: () => <span>child</span>,
  } as unknown as BlockRenderArgs<never>;
  // Awaited because several blocks are async server components: calling `render` on one returns a
  // promise of the element rather than the element itself.
  return (await block.render(args)) as ReactNode;
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
      const classed = classedElements(await drawnBy(block), BLOCK_CLASS);
      // Asserted BEFORE the absence below, which is otherwise satisfied by absence: a block whose
      // example renders nothing, or which never applies the class it is handed, would yield an empty
      // list and pass a "no style" check while never having been examined.
      expect(classed).toHaveLength(1);
      const { style } = classed[0]!.props as { style?: unknown };
      expect(style).toBeUndefined();
    }
  );

  it("would catch a block that styled the element carrying the class", async () => {
    // The positive control, exercising the SAME finder and the SAME property the per-block cases
    // use. A control asserting something adjacent could stay green while the real check stopped
    // recognising a style at all.
    const styled: DrawableBlock = {
      ...DRAWABLE[0]!,
      render: () => <div className={BLOCK_CLASS} style={{ padding: 24 }} />,
    };
    const classed = classedElements(await drawnBy(styled), BLOCK_CLASS);
    expect(classed).toHaveLength(1);
    expect((classed[0]!.props as { style?: unknown }).style).toBeDefined();
  });

  it("looks past a wrapper to the element that carries the class", async () => {
    // The case a first-opening-tag reader gets wrong: the outermost element is not necessarily the
    // one the compiled rules land on, so a style on the classed DESCENDANT must still be found.
    const wrapped: DrawableBlock = {
      ...DRAWABLE[0]!,
      render: () => (
        <section>
          <div className={BLOCK_CLASS} style={{ padding: 24 }} />
        </section>
      ),
    };
    const classed = classedElements(await drawnBy(wrapped), BLOCK_CLASS);
    expect(classed).toHaveLength(1);
    expect((classed[0]!.props as { style?: unknown }).style).toBeDefined();
  });

  it("does not mistake an attribute VALUE for a style attribute", async () => {
    // Reading the prop rather than the serialized tag is what makes this true. Text matching on an
    // opening tag reports a style here and rejects markup no style control competes with.
    const decoy: DrawableBlock = {
      ...DRAWABLE[0]!,
      render: () => <div className={BLOCK_CLASS} title="use style=compact" />,
    };
    const classed = classedElements(await drawnBy(decoy), BLOCK_CLASS);
    expect(classed).toHaveLength(1);
    expect((classed[0]!.props as { style?: unknown }).style).toBeUndefined();
  });
});
