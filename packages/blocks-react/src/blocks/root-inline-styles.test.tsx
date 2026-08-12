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
 */
import { describe, expect, it } from "vitest";

import type { BlockNode } from "@nextlyhq/blocks-engine";
import { isValidElement, type ReactElement, type ReactNode } from "react";

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

/** Every element in a render result, the root included. */
function elementsIn(node: ReactNode): ReactElement[] {
  if (!isValidElement(node)) {
    // An array or a fragment's children arrive here as a plain iterable; a
    // string, number, null or boolean has no props to inspect and ends the walk.
    if (Array.isArray(node)) return node.flatMap(child => elementsIn(child));
    return [];
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [element, ...elementsIn(element.props.children)];
}

/** The elements a block put its given class on. */
function classCarriers(node: ReactNode): ReactElement<{ style?: unknown }>[] {
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
  const drawn = coreBlocks.filter(block => {
    // A block whose example props make it draw nothing has no root to inspect.
    // Filtered explicitly rather than silently skipped, so the count below
    // reports what was actually examined.
    const output = block.render(renderArgs(block.example.props));
    return classCarriers(output).length > 0;
  });

  it("inspects most of the library, so the rule is not vacuous", () => {
    // The guard's own positive control. Every assertion below is satisfied by a
    // block that renders nothing, by a walk that never reaches an element, and
    // by a class name that stopped matching — all of which look identical to a
    // clean library. This is the assertion that separates them.
    expect(coreBlocks.length).toBeGreaterThan(5);
    expect(drawn.length).toBeGreaterThan(coreBlocks.length / 2);
  });

  it.each(drawn.map(block => [block.name, block] as const))(
    "%s renders no inline style on the element carrying its class",
    (name, block) => {
      const offenders = classCarriers(
        block.render(renderArgs(block.example.props))
      ).filter(element => element.props.style !== undefined);

      if (ALLOWED.has(name)) {
        expect(
          offenders.length,
          `${name} is allow-listed but no longer needs it: ${ALLOWED.get(name) ?? ""}`
        ).toBeGreaterThan(0);
        return;
      }

      expect(
        offenders.map(element => JSON.stringify(element.props.style)),
        `${name} puts an inline style on the element it was given a class for. ` +
          "An inline declaration beats every class rule, so a style control " +
          "writing that property compiles CSS with no visible effect. Move the " +
          "default to `baseStyles`, which the compiler emits as the block-type " +
          "tier beneath the node's own values."
      ).toEqual([]);
    }
  );
});
