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
 * Measured on SERIALIZED HTML rather than on the element tree, and that is the
 * load-bearing choice. A block may return a component rather than a host
 * element — `<Root className={className} />` — which forwards the class inward
 * and adds a style of its own. Walking the returned elements sees the class on
 * an unresolved component, counts the block as covered, and finds no style, so
 * the block reads clean while its actual DOM root carries one. Rendering
 * resolves every component, so what is inspected is what a browser receives.
 *
 * Rendered through the streaming renderer because a core block may be an async
 * server component; the static renderer cannot express one.
 *
 * Every assertion here is satisfied by finding nothing, so the detector is given
 * a positive control of its own: a synthetic block with a known inline style is
 * driven through the same tag match, property parse and aggregation, and must be
 * reported. Without it, a regression that made the parser return nothing would
 * leave the whole suite green.
 */
import { describe, expect, it } from "vitest";

import type {
  AnyBlockDefinition,
  BlockNode,
  BlockRenderArgs,
} from "@nextlyhq/blocks-engine";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";

import type { PageContext } from "../context";

import { coreBlocks } from "./index";

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
 * Empty, and that is the ratchet: no core block needs one, so any entry is a
 * deliberate act with an argument attached. A geometry the compiler cannot
 * express would be a fair entry; a colour, a spacing or a border would not,
 * because those are exactly what an author reaches for a control to change.
 */
const ALLOWED: ReadonlyMap<string, ReadonlySet<string>> = new Map();

/**
 * The host services every render receives, all inert.
 *
 * Answering nothing is what a standalone render does anyway, but they must be
 * PRESENT: a block that reaches for one it was not given throws, and the failure
 * reads as a block defect rather than as a thin fixture.
 */
/**
 * The host services a render receives, in both of the states a block branches on.
 *
 * A permanently inert host inspects only the empty path. `core/image` takes a
 * different one once `resolveMedia` answers with a record, so a style written on
 * the resolved branch would never be reached. Both states are exercised.
 */
function contexts(): PageContext[] {
  const empty = {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };
  const answering = {
    entry: { id: "e1", title: "An entry" },
    data: {
      find: () =>
        Promise.resolve({ items: [{ id: "e1", title: "An entry" }], total: 1 }),
    },
    resolveMedia: () =>
      Promise.resolve({
        id: "m1",
        url: "https://example.com/x.png",
        alt: "x",
        width: 800,
        height: 600,
      }),
    resolveEntryPath: () => Promise.resolve("/an-entry"),
  };
  return [empty, answering] as unknown as PageContext[];
}

/**
 * The node a block is rendered with, carrying ITS OWN identity.
 *
 * `BlockBoundary` passes the document node whose type selected the definition,
 * and a block or a shared helper may branch on `node.type` or `node.version`.
 * One shared node would hand every block another block's identity, so a style
 * written only on that branch would never be reached.
 */
function nodeFor(block: AnyBlockDefinition, props: unknown): BlockNode {
  // The SAME object reaches `args.props` and `args.node.props` in production, so
  // a branch reading either sees what the other saw.
  return {
    id: "n1",
    type: block.name,
    version: block.version,
    props: props as BlockNode["props"],
  };
}

function renderArgs(
  block: AnyBlockDefinition,
  props: unknown,
  ctx: PageContext
): BlockRenderArgs<object, unknown> {
  return {
    props,
    node: nodeFor(block, props),
    className: NODE_CLASS,
    ctx,
    renderSlot: () => <span>child</span>,
  } as unknown as BlockRenderArgs<object, unknown>;
}

/**
 * What a document actually STORES for a declared option.
 *
 * A select may be declared with primitive options or with the `{ label, value }`
 * records the field system requires, and the conversion stores `entry.value`.
 * Passing the record itself would leave a branch such as
 * `props.variant === "outline"` inactive.
 */
function storedValueOf(option: unknown): unknown {
  if (
    typeof option === "object" &&
    option !== null &&
    "value" in option &&
    typeof (option as { value: unknown }).value === "string"
  ) {
    return (option as { value: string }).value;
  }
  return option;
}

/**
 * A plausible stored value for a prop that enumerates nothing.
 *
 * A root style can be conditional on any prop, not only a select — an icon name,
 * a width, a checkbox — and an example that leaves such a prop empty renders the
 * branch that has no style. Values are keyed on the DECLARED type so they stay
 * plausible: a block handed a URL where it expected one may take a different
 * path, but it is not being handed nonsense.
 */
const REPRESENTATIVE: ReadonlyMap<string, readonly unknown[]> = new Map([
  ["text", ["x"]],
  ["textarea", ["x"]],
  ["richtext", ["x"]],
  ["url", ["https://example.com/x"]],
  ["media", ["https://example.com/x.png"]],
  ["number", [1]],
  ["checkbox", [true, false]],
  ["boolean", [true, false]],
  ["color", ["#123456"]],
]);

/** The prop sets each block is exercised with. */
function propVariants(block: AnyBlockDefinition): unknown[] {
  const base = {
    ...(block.defaultProps ?? {}),
    ...(block.example.props ?? {}),
  } as Record<string, unknown>;
  const variants: unknown[] = [base];
  const schema: Record<string, unknown> = block.props ?? {};
  for (const [name, entry] of Object.entries(schema)) {
    const options: unknown = (entry as { options?: unknown }).options;
    if (Array.isArray(options)) {
      for (const option of options) {
        variants.push({ ...base, [name]: storedValueOf(option) });
      }
      continue;
    }
    const declared: unknown = (entry as { type?: unknown }).type;
    const values =
      typeof declared === "string" ? REPRESENTATIVE.get(declared) : undefined;
    for (const value of values ?? []) {
      variants.push({ ...base, [name]: value });
    }
  }
  return [...variants, ...layeredVariants(base, schema)];
}

/**
 * Cases that move EVERY prop at once, not one at a time.
 *
 * A style conditional on a conjunction — `label === "x" && type === "submit"` —
 * is reached by neither single-prop case, because each retains the example's
 * value for the other. Layer `i` gives every prop its i-th alternative, so the
 * conjunctions formed from those alternatives are exercised.
 *
 * Bounded to the widest prop's alternative count rather than the cross product,
 * which would be exponential in the number of props. What that leaves uncovered
 * is a conjunction needing values from DIFFERENT layers, or one keyed on a
 * specific free-text value no schema enumerates.
 */
function layeredVariants(
  base: Record<string, unknown>,
  schema: Record<string, unknown>
): unknown[] {
  const alternatives = new Map<string, readonly unknown[]>();
  for (const [name, entry] of Object.entries(schema)) {
    const options: unknown = (entry as { options?: unknown }).options;
    if (Array.isArray(options)) {
      alternatives.set(name, options.map(storedValueOf));
      continue;
    }
    const declared: unknown = (entry as { type?: unknown }).type;
    const values =
      typeof declared === "string" ? REPRESENTATIVE.get(declared) : undefined;
    if (values !== undefined) alternatives.set(name, values);
  }
  const depth = Math.max(0, ...[...alternatives.values()].map(v => v.length));
  const layers: unknown[] = [];
  for (let i = 0; i < depth; i += 1) {
    const layer: Record<string, unknown> = { ...base };
    for (const [name, values] of alternatives) {
      // Clamped rather than skipped, so a prop with fewer alternatives still
      // contributes one to every layer instead of dropping out of the later
      // conjunctions entirely.
      layer[name] = values[Math.min(i, values.length - 1)];
    }
    layers.push(layer);
  }
  return layers;
}

/** A block's output as a browser would receive it. */
async function renderHtml(
  block: AnyBlockDefinition,
  props: unknown,
  ctx: PageContext
): Promise<string> {
  // `BlockRenderResult` is `unknown` on purpose: the engine declares the block
  // contract without depending on React types. This file is inside the React
  // renderer, which is the layer entitled to say what that value is, and a wrong
  // narrowing cannot pass silently — the renderer throws on anything it cannot
  // draw, and `onError` rethrows into the test.
  const node = (await block.render(renderArgs(block, props, ctx))) as ReactNode;
  const stream = await renderToReadableStream(node, {
    onError(error: unknown) {
      throw error;
    },
  });
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
  /** Whether the block's rendered output carried the class at least once. */
  reached: boolean;
  /** `block: property` for every disallowed inline declaration on a root. */
  offenders: string[];
}

/**
 * One block, every variant, through the whole detection path.
 *
 * Shared with the detector's own control so the two cannot diverge: a control
 * that reimplemented the match would certify itself rather than this.
 */
async function inspectBlock(block: AnyBlockDefinition): Promise<Inspection> {
  const permitted = ALLOWED.get(block.name) ?? new Set<string>();
  const offenders: string[] = [];
  let reached = false;
  for (const props of propVariants(block)) {
    for (const ctx of contexts()) {
      for (const tag of classCarryingTags(
        await renderHtml(block, props, ctx)
      )) {
        reached = true;
        for (const property of inlinePropertiesOf(tag)) {
          if (permitted.has(property)) continue;
          offenders.push(`${block.name}: ${property}`);
        }
      }
    }
  }
  return { reached, offenders };
}

/** A block that does the thing this file forbids, for checking the detector. */
const STYLED_PROBE = {
  name: "test/styled-probe",
  version: 1,
  example: { props: {} },
  // Returns a COMPONENT that adds the style internally, not a host element.
  // A probe returning `<div className style>` directly is found by shallow
  // element inspection too, so it could not tell a working detector from the
  // element-walking one this replaced — the very regression it exists to catch.
  render: ({ className }: { className: string }) => {
    const Root = (inner: { className: string }) => (
      <div className={inner.className} style={{ color: "red" }}>
        probe
      </div>
    );
    return <Root className={className} />;
  },
} as unknown as AnyBlockDefinition;

describe("the detector itself", () => {
  it("reports a known inline style, so an empty result means clean", async () => {
    // Every other assertion in this file is satisfied by finding nothing, and
    // `reached` is populated by the class match alone — so a parser or
    // aggregation that regressed to returning nothing would leave them all
    // green. This drives a block that IS in breach through the same path.
    const { reached, offenders } = await inspectBlock(STYLED_PROBE);

    expect(reached).toBe(true);
    // Deduped, as the library assertion is: a block is rendered once per host
    // state and per prop variant, so one breach is reported once per case.
    expect([...new Set(offenders)]).toEqual(["test/styled-probe: color"]);
  });
});

describe("a core block's root element", () => {
  it("carries no inline style, and every block was actually reached", async () => {
    const results = await Promise.all(
      coreBlocks.map(async block => {
        const definition = block as AnyBlockDefinition;
        return { name: definition.name, ...(await inspectBlock(definition)) };
      })
    );

    // The vacuity control, BY NAME. A count is satisfied by any nine of twelve,
    // so it cannot tell a library that grew a clean block from one whose
    // riskiest block stopped being rendered.
    expect(results.filter(r => !r.reached).map(r => r.name)).toEqual([]);

    expect(
      [...new Set(results.flatMap(r => r.offenders))].sort(),
      "A block wrote an inline style on the element it was given a class for. " +
        "An inline declaration beats every class rule, so a style control " +
        "writing that property compiles CSS with no visible effect. Move the " +
        "default to `baseStyles`, which the compiler emits as the block-type " +
        "tier beneath the node's own values."
    ).toEqual([]);
  });
});
