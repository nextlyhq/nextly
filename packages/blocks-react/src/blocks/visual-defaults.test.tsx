import { renderToStaticMarkup } from "react-dom/server";
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
 * The attributes of the element a block puts its own `className` on, as a browser would receive it.
 *
 * Rendered to markup and read back rather than inspected as a React element tree. The tree is what
 * the block AUTHORED, and a root delegated to a component — `render: () => <Root className={x} />` —
 * appears there as an unexecuted `<Root>` whose own props carry no style, while the host element it
 * eventually returns carries both the class and the declaration. Rendering through is what closes
 * that, and it is also what a page actually ships.
 *
 * Found by CLASS rather than by position, so a block that wraps its content is read at the element
 * the compiled rules land on rather than at the wrapper.
 *
 * Attribute NAMES are enumerated rather than the text being searched. React escapes `"` inside a
 * value as `&quot;`, so quotes delimit values unambiguously in its own output and this parse is
 * sound for it — which is what lets `title="use style=compact"` be read as a `title`, where matching
 * the text reports a style attribute that is not there.
 */
function classedAttributes(html: string, className: string): string[][] {
  const tags = [
    ...html.matchAll(
      /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*\/?>/g
    ),
  ];
  const matched: string[][] = [];
  for (const tag of tags) {
    const attributes = [...tag[2]!.matchAll(/\s([a-zA-Z-]+)="([^"]*)"/g)];
    const classes = attributes.find(pair => pair[1] === "class")?.[2] ?? "";
    if (!classes.split(/\s+/).includes(className)) continue;
    matched.push(attributes.map(pair => pair[1]!));
  }
  return matched;
}

/**
 * Render one block the way a page would, from the worked instance it is required to publish.
 *
 * `example` rather than hand-written props: every definition carries one, so no block is skipped for
 * want of a fixture, and the props are the author's own rather than a guess that might miss the
 * branch that styles anything.
 */
async function markupOf(block: DrawableBlock): Promise<string> {
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
  // promise of the element, and handing that straight to the renderer suspends instead of drawing.
  return renderToStaticMarkup((await block.render(args)) as ReactElement);
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
      const classed = classedAttributes(await markupOf(block), BLOCK_CLASS);
      // Asserted BEFORE the absence below, which is otherwise satisfied by absence: a block whose
      // example renders nothing, or which never applies the class it is handed, yields an empty
      // list and would pass a "no style" check having been examined at all.
      expect(classed).toHaveLength(1);
      expect(classed[0]).not.toContain("style");
    }
  );

  it("would catch a block that styled the element carrying the class", async () => {
    // The positive control, exercising the SAME reader and the SAME property the cases above use.
    // A control asserting something adjacent could stay green while the real check stopped
    // recognising a style at all.
    const styled: DrawableBlock = {
      ...DRAWABLE[0]!,
      render: () => <div className={BLOCK_CLASS} style={{ padding: 24 }} />,
    };
    expect(classedAttributes(await markupOf(styled), BLOCK_CLASS)[0]).toContain(
      "style"
    );
  });

  it("sees through a root delegated to a component", async () => {
    // The case an element-tree walk gets wrong: `<Root className={x} />` appears in the authored
    // tree as an unexecuted element whose own props carry no style, while the host element it
    // returns carries both the class and the declaration.
    const Root = ({ className }: { className: string }) => (
      <div className={className} style={{ padding: 24 }} />
    );
    const delegated: DrawableBlock = {
      ...DRAWABLE[0]!,
      render: () => <Root className={BLOCK_CLASS} />,
    };
    expect(
      classedAttributes(await markupOf(delegated), BLOCK_CLASS)[0]
    ).toContain("style");
  });

  it("looks past a wrapper to the element that carries the class", async () => {
    // The outermost element is not necessarily the one the compiled rules land on, so a style on
    // the classed DESCENDANT must still be found.
    const wrapped: DrawableBlock = {
      ...DRAWABLE[0]!,
      render: () => (
        <section>
          <div className={BLOCK_CLASS} style={{ padding: 24 }} />
        </section>
      ),
    };
    expect(
      classedAttributes(await markupOf(wrapped), BLOCK_CLASS)[0]
    ).toContain("style");
  });

  it("does not mistake an attribute VALUE for a style attribute", async () => {
    // Enumerating attribute NAMES is what makes this true. React escapes `"` inside a value as
    // `&quot;`, so the decoy serializes as `title="use style=&quot;x&quot;"` and its `style=` is
    // inside the value. Matching the text reports a style attribute that does not exist, and
    // rejects markup no style control competes with.
    const decoy: DrawableBlock = {
      ...DRAWABLE[0]!,
      render: () => (
        <div className={BLOCK_CLASS} title={'use style="compact"'} />
      ),
    };
    const attributes = classedAttributes(await markupOf(decoy), BLOCK_CLASS)[0];
    expect(attributes).toContain("title");
    expect(attributes).not.toContain("style");
  });
});
