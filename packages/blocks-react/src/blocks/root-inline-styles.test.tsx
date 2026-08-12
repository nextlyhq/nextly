/**
 * A core block may not put an inline style on the element it was given a class
 * for.
 *
 * An inline declaration outranks every class rule regardless of source order or
 * specificity, so a block that writes one on its own root defeats the entire
 * style system for that property: the node's own controls, the site's named
 * classes, and a consumer's stylesheet all compile CSS that has no visible
 * effect, with nothing anywhere reporting it. A block's visual defaults belong
 * in `baseStyles`, which the compiler emits as the block-type tier — beneath the
 * node's own values, so a control can still win.
 *
 * The proof-of-concept block library this package replaces has six blocks whose
 * own Style-tab controls are already dead for exactly this reason. Those blocks
 * get ported here, and a render body is copied more readily than it is reread,
 * so the moment of risk is the port rather than anything written today. This
 * fails at that moment instead of after someone notices a control doing nothing.
 *
 * Checked on the RENDERED OUTPUT rather than by scanning source. A syntax scan
 * has an unbounded surface — it already missed a block that assembled a
 * `CSSProperties` object separately and applied it as `style={hasStyle ? s : undefined}` —
 * whereas the output either carries the attribute or does not.
 *
 * The output has to be AWAITED. Several blocks are async server components, so a
 * walk over what `render` returns synchronously reaches a promise, finds no
 * element on it, and reports them clean — which is how a first version of this
 * silently exempted `core/image`, `core/button` and `core/collection-loop`, the
 * three most likely to carry a computed style. Coverage is therefore asserted
 * per block by name rather than as a count.
 */
import { describe, expect, it } from "vitest";

import type { AnyBlockDefinition, BlockNode } from "@nextlyhq/blocks-engine";
import { isValidElement, type ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { coreBlocks } from "./index";

const NODE: BlockNode = { id: "n1", type: "core/box", version: 1, props: {} };

/** The class the renderer hands a block for its root element. */
const NODE_CLASS = "nx-n1";

/**
 * Blocks that must carry an inline style on their root, with the reason.
 *
 * Empty, and that is the ratchet: every core block today renders without one, so
 * an addition here is a deliberate act with an argument attached rather than a
 * default anybody can drift into. A geometric value the compiler cannot express
 * would be a fair entry; a colour, a spacing or a border would not, because
 * those are precisely what an author reaches for a control to change.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map();

function context(): PageContext {
  return {
    item: undefined,
    locale: undefined,
    data: undefined,
  } as unknown as PageContext;
}

function renderArgs<P>(props: P): BlockRenderArgs<P> {
  return {
    props,
    node: NODE,
    className: NODE_CLASS,
    ctx: context(),
    renderSlot: () => <span>child</span>,
  } as BlockRenderArgs<P>;
}

/**
 * A block's output, whether it renders synchronously or as a server component.
 *
 * Taken as `AnyBlockDefinition` — the erased shape the registry itself stores —
 * because `coreBlocks` is a union of definitions with different prop types and a
 * union of functions cannot be called with any one of them. That is the same
 * erasure `registerBlocks` performs, so nothing here is looser than production.
 */
async function rendered(block: AnyBlockDefinition): Promise<unknown> {
  return await block.render(renderArgs(block.example.props));
}

/** Every element in a render result, the root included. */
function elementsIn(node: unknown): ReactElement[] {
  if (!isValidElement(node)) {
    // An array or a fragment's children arrive here as a plain iterable; a
    // string, number, null or boolean has no props to inspect and ends the walk.
    if (Array.isArray(node)) return node.flatMap(child => elementsIn(child));
    return [];
  }
  const children: unknown = (node.props as { children?: unknown }).children;
  return [node, ...elementsIn(children)];
}

/** The inline style an element carries, if any. Props are unknown-shaped here. */
function inlineStyleOf(element: ReactElement): unknown {
  return (element.props as { style?: unknown }).style;
}

/** The elements a block put its given class on. */
function classCarriers(node: unknown): ReactElement[] {
  return elementsIn(node).filter(element => {
    const className: unknown = (element.props as { className?: unknown })
      .className;
    return (
      typeof className === "string" &&
      className.split(/\s+/).includes(NODE_CLASS)
    );
  });
}

describe("a core block's root element", () => {
  /**
   * Which blocks put their class on something, resolved once.
   *
   * Named rather than counted. A count is satisfied by any nine of twelve, so it
   * cannot tell a library that grew a clean block from one whose riskiest block
   * stopped being reached — and the second is exactly what happened here.
   */
  async function inspectable(): Promise<Map<string, ReactElement[]>> {
    const found = new Map<string, ReactElement[]>();
    for (const block of coreBlocks) {
      const carriers = classCarriers(await rendered(block));
      if (carriers.length > 0) found.set(block.name, carriers);
    }
    return found;
  }

  it("reaches every block that draws, named rather than counted", async () => {
    const found = await inspectable();
    const missing = coreBlocks
      .map(block => block.name)
      .filter(name => !found.has(name));

    // EVERY core block is reached, `core/collection-loop` included — it draws its
    // empty state when no provider answers rather than drawing nothing. A name
    // appearing here means the walk stopped finding that block, and the
    // assertion below would then pass by never running against it.
    expect(missing).toEqual([]);
  });

  it("puts no inline style on the element it was given a class for", async () => {
    const found = await inspectable();
    const offenders: string[] = [];
    for (const [name, carriers] of found) {
      const inline = carriers.filter(el => inlineStyleOf(el) !== undefined);
      if (ALLOWED.has(name)) {
        expect(
          inline.length,
          `${name} is allow-listed but no longer needs it: ${ALLOWED.get(name) ?? ""}`
        ).toBeGreaterThan(0);
        continue;
      }
      for (const el of inline) {
        offenders.push(`${name}: ${JSON.stringify(inlineStyleOf(el))}`);
      }
    }

    expect(
      offenders,
      "A block put an inline style on the element it was given a class for. " +
        "An inline declaration beats every class rule, so a style control " +
        "writing that property compiles CSS with no visible effect. Move the " +
        "default to `baseStyles`, which the compiler emits as the block-type " +
        "tier beneath the node's own values."
    ).toEqual([]);
  });
});
