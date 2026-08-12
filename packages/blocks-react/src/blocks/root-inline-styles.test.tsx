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
 * so the moment of risk is the port rather than anything written today.
 *
 * Measured on SERIALIZED HTML rather than on the element tree, and that is the
 * load-bearing choice. A block may return a component rather than a host
 * element — `<Root className={className} />` — which forwards the class inward
 * and adds a style of its own. Walking the returned elements sees the class on
 * an unresolved component, counts the block as covered, and finds no style, so
 * the block reads clean while its actual DOM root carries one. Rendering
 * resolves every component, so what is inspected is what a browser receives.
 *
 * Rendered through the streaming renderer because several core blocks are async
 * server components. The static renderer cannot express them, and an earlier
 * version of this file that walked the synchronous return value silently
 * exempted all three of them.
 */
import { describe, expect, it } from "vitest";

import type { AnyBlockDefinition, BlockNode } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";

import type { BlockRenderArgs, PageContext } from "../context";

import { coreBlocks } from "./index";

const NODE: BlockNode = { id: "n1", type: "core/box", version: 1, props: {} };

/** The class the renderer hands a block for its root element. */
const NODE_CLASS = "nx-n1";

/**
 * Inline CSS properties a named block is permitted to write on its root.
 *
 * Keyed by block AND by property, never by block alone. A block exempted
 * wholesale could later add `color` or `padding` to the same style object and
 * stay green, which is precisely what this rule exists to catch — the exemption
 * would silently widen from the one value that earned it to everything beside
 * it.
 *
 * Empty, and that is the ratchet: no core block needs one today, so any entry is
 * a deliberate act with an argument attached. A geometry the compiler cannot
 * express would be a fair entry; a colour, a spacing or a border would not,
 * because those are exactly what an author reaches for a control to change.
 */
const ALLOWED: ReadonlyMap<string, ReadonlySet<string>> = new Map();

function context(): PageContext {
  return {
    item: undefined,
    locale: undefined,
    data: undefined,
  } as unknown as PageContext;
}

function renderArgs(props: unknown): BlockRenderArgs<never> {
  return {
    props,
    node: NODE,
    className: NODE_CLASS,
    ctx: context(),
    renderSlot: () => <span>child</span>,
  } as unknown as BlockRenderArgs<never>;
}

/**
 * The prop sets each block is exercised with.
 *
 * One example is not exhaustive: the PoC button builds a root style only when an
 * icon, an explicit width or an outline variant is chosen, and none of those
 * appear in a palette example — so a port of that implementation would keep a
 * single-example guard green while real documents received overriding styles.
 *
 * Variants are DERIVED from the block's own prop schema rather than hand-listed,
 * so they cannot drift as a block gains options: every declared `select` is
 * exercised at each of its options. What this does NOT reach is a style branch
 * keyed on a free-text or numeric prop, which no schema enumerates; those remain
 * covered only by whatever the example supplies.
 */
function propVariants(block: AnyBlockDefinition): unknown[] {
  const base = {
    ...(block.defaultProps ?? {}),
    ...(block.example.props ?? {}),
  } as Record<string, unknown>;
  const variants: unknown[] = [base];
  const schema: Record<string, unknown> = block.props ?? {};
  for (const [name, entry] of Object.entries(schema)) {
    const options: unknown = (entry as { options?: unknown }).options;
    if (!Array.isArray(options)) continue;
    for (const option of options) {
      variants.push({ ...base, [name]: option });
    }
  }
  return variants;
}

/** A block's output as a browser would receive it. */
async function renderHtml(
  block: AnyBlockDefinition,
  props: unknown
): Promise<string> {
  // Wrapped as a component because the render result is a node, and an async
  // block hands back a promise — the renderer resolves either through this.
  const Block = (): unknown => block.render(renderArgs(props));
  const stream = await renderToReadableStream(
    (<Block />) as unknown as ReactElement,
    {
      onError(error: unknown) {
        throw error;
      },
    }
  );
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value);
  }
  return html;
}

/** Every opening tag whose class attribute carries the node class. */
function classCarryingTags(html: string): string[] {
  const tags = html.match(/<[a-zA-Z][a-zA-Z0-9-]*\s[^>]*>/g) ?? [];
  return tags.filter(tag => {
    const attr = /\sclass="([^"]*)"/.exec(tag);
    return attr !== null && attr[1].split(/\s+/).includes(NODE_CLASS);
  });
}

/** The CSS property names an opening tag declares inline. */
function inlinePropertiesOf(tag: string): string[] {
  const attr = /\sstyle="([^"]*)"/.exec(tag);
  if (attr === null) return [];
  return attr[1]
    .split(";")
    .map(declaration => declaration.split(":")[0]?.trim() ?? "")
    .filter(name => name.length > 0);
}

interface Inspection {
  /** Blocks whose rendered output carried the class at least once. */
  reached: Set<string>;
  /** `block: property` for every disallowed inline declaration on a root. */
  offenders: string[];
}

/**
 * One pass over the library, shared by both assertions.
 *
 * Rendered ONCE rather than per assertion. A block whose second render differs —
 * one that consumed a provider, or answered from state — would let a coverage
 * check pass on the first pass while the style check silently examined nothing
 * on the second, and that failure looks identical to a clean library.
 */
async function inspect(): Promise<Inspection> {
  const reached = new Set<string>();
  const offenders: string[] = [];
  for (const block of coreBlocks) {
    const definition = block as AnyBlockDefinition;
    const permitted = ALLOWED.get(definition.name) ?? new Set<string>();
    for (const props of propVariants(definition)) {
      const html = await renderHtml(definition, props);
      for (const tag of classCarryingTags(html)) {
        reached.add(definition.name);
        for (const property of inlinePropertiesOf(tag)) {
          if (permitted.has(property)) continue;
          offenders.push(`${definition.name}: ${property}`);
        }
      }
    }
  }
  return { reached, offenders };
}

describe("a core block's root element", () => {
  it("carries no inline style, and every block was actually reached", async () => {
    const { reached, offenders } = await inspect();

    // The vacuity control, asserted in the SAME pass and BY NAME. A count is
    // satisfied by any nine of twelve, so it cannot tell a library that grew a
    // clean block from one whose riskiest block stopped being rendered — and
    // that second case is what an earlier version of this file did.
    const missing = coreBlocks
      .map(block => (block as AnyBlockDefinition).name)
      .filter(name => !reached.has(name));
    expect(missing).toEqual([]);

    expect(
      [...new Set(offenders)].sort(),
      "A block wrote an inline style on the element it was given a class for. " +
        "An inline declaration beats every class rule, so a style control " +
        "writing that property compiles CSS with no visible effect. Move the " +
        "default to `baseStyles`, which the compiler emits as the block-type " +
        "tier beneath the node's own values."
    ).toEqual([]);
  });
});
