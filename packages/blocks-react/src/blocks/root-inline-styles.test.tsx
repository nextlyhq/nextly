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

import { blockTypeClassName, nodeClassName } from "@nextlyhq/blocks-engine";
import type {
  AnyBlockDefinition,
  BlockNode,
  BlockRenderArgs,
} from "@nextlyhq/blocks-engine";
import type { ReactNode } from "react";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";

import type { PageContext } from "../context";

import { coreBlocks } from "./index";

/** The node id every fixture renders under. */
const NODE_ID = "n1";

/**
 * The class a block is handed, in the shape production uses.
 *
 * `classNameFor` always passes the node class AND the block-type class together,
 * so a root helper branching on that two-class shape takes a different path when
 * handed one class alone.
 */
function classNameFor(block: AnyBlockDefinition): string {
  return `${nodeClassName(NODE_ID)} ${blockTypeClassName(block.name)}`;
}

/** The node class alone, which is what a root element is matched on. */
const NODE_CLASS = nodeClassName(NODE_ID);

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
 * Every block this file expects to inspect.
 *
 * Listed rather than counted so that removing one fails here instead of quietly
 * shrinking what the suite covers, and adding one is a deliberate edit rather
 * than an unnoticed gap.
 */
const EXPECTED_BLOCKS = [
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
].sort();

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
  // A routed page attaches a query budget, and a block can branch on it being
  // exhausted. A collection block also takes a distinct path when no provider is
  // configured at all, which neither host above can produce because both define
  // `data` and `PageContext.data` is optional.
  const noProvider = { ...answering, data: undefined };
  // A host read can fail, and a block may render a different tree while handling
  // it. A rejected promise is the production shape, not a thrown call.
  const failing = {
    ...answering,
    data: { find: () => Promise.reject(new Error("read failed")) },
  };
  // A routed render sets a locale, and a block can branch on it when building
  // its query, so the unlocalized state alone leaves that path uninspected.
  const localized = { ...answering, locale: "fr" };
  // A resolver can reject, and image and button both catch that and render a
  // different tree. Resolving to null is not the same path.
  const rejecting = {
    ...answering,
    resolveMedia: () => Promise.reject(new Error("media lookup failed")),
    resolveEntryPath: () => Promise.reject(new Error("path lookup failed")),
  };
  const budgetSpent = { ...answering, queries: { take: () => false } };
  const budgetAvailable = { ...answering, queries: { take: () => true } };
  return [
    empty,
    answering,
    noProvider,
    failing,
    rejecting,
    localized,
    budgetSpent,
    budgetAvailable,
  ] as unknown as PageContext[];
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
    id: NODE_ID,
    type: block.name,
    version: block.version,
    props: props as BlockNode["props"],
  };
}

/**
 * Host policies a render is exercised under.
 *
 * `BlockBoundary` forwards one to every block, and image and embed already
 * branch on `remotePatterns` and `trustedFrameOrigins` — so a root style
 * introduced on a configured-policy path is invisible with the policy always
 * absent. Both states run.
 */
function hostPolicies(): (object | undefined)[] {
  return [
    undefined,
    {
      remotePatterns: [{ protocol: "https", hostname: "example.com" }],
      trustedFrameOrigins: ["https://example.com"],
    },
    // A policy that PERMITS everything the host answers with leaves the refusal
    // paths unreachable, and the policy above allows exactly the origin the
    // media resolver returns. This one allows a different origin, so a resolved
    // record is refused while a relative `src` still passes — `isFetchableUrl`
    // admits any non-remote url — which is the one arrangement that reaches
    // `core/image`'s fallback to the typed prop, and the state where `embed`
    // has trusted origins configured and the stored one is not among them.
    {
      remotePatterns: [{ protocol: "https", hostname: "cdn.test" }],
      trustedFrameOrigins: ["https://cdn.test"],
    },
  ];
}

function renderArgs(
  block: AnyBlockDefinition,
  props: unknown,
  ctx: PageContext,
  hostPolicy: object | undefined
): BlockRenderArgs<object, unknown> {
  return {
    props,
    node: nodeFor(block, props),
    className: classNameFor(block),
    ctx,
    renderSlot: () => <span>child</span>,
    ...(hostPolicy === undefined ? {} : { hostPolicy }),
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
  // Two numbers, because one that equals the default cannot separate an omitted
  // prop from an explicitly-set one — `core/list` normalises `start: 1` to its
  // default, so a branch on `start !== 1` needs a second value.
  ["number", [1, 3]],
  // A single-element list is its own branch: a block may lay out one item
  // differently from several, and neither an empty default nor a two-item
  // example reaches it.
  ["array", [["one"], ["one", "two", "three"]]],
  ["checkbox", [true, false]],
  ["boolean", [true, false]],
  ["color", ["#123456"]],
]);

/**
 * Every alternative value a declared prop can take, derived ONCE.
 *
 * Both the per-prop pass and the layered pass need this, and interpreting the
 * schema twice would let support for a new prop shape reach one and not the
 * other — so individual and conjunction coverage would silently disagree about
 * which branches exist.
 */
function alternativesFor(
  schema: Record<string, unknown>
): Map<string, readonly unknown[]> {
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
  return alternatives;
}

/** The prop sets each block is exercised with. */
function propVariants(block: AnyBlockDefinition): unknown[] {
  const base = {
    ...(block.defaultProps ?? {}),
    ...(block.example.props ?? {}),
  } as Record<string, unknown>;
  const schema: Record<string, unknown> = block.props ?? {};
  const alternatives = alternativesFor(schema);
  // The UNMODIFIED defaults are their own case. Spreading the example over them
  // means the real default state is never rendered when the example differs —
  // `core/button` defaults to no destination and renders a `<button>`, while its
  // example supplies one and every derived case keeps it.
  const defaults = {
    ...((block.defaultProps ?? {}) as Record<string, unknown>),
  };
  const variants: unknown[] = [defaults, base];
  for (const [name, values] of alternatives) {
    for (const value of values) {
      variants.push({ ...base, [name]: value });
    }
  }
  return [
    ...variants,
    ...layeredVariants(base, alternatives),
    ...malformedVariants(base, schema),
  ];
}

/**
 * Prop sets carrying values a stored document can really hold.
 *
 * `sanitizeDocument` deliberately keeps content it cannot validate, so a node
 * hand-edited or written by an older version reaches `render` with the wrong
 * TYPE — and renderers have their own fallbacks for that, which are branches
 * like any other. `renderContainer` turning `{ as: "img" }` into a `div` is one.
 * Every other variant here is type-correct, so none of those paths is reached.
 */
function malformedVariants(
  base: Record<string, unknown>,
  schema: Record<string, unknown>
): unknown[] {
  const wrongTypes: unknown[] = [42, {}, [], null];
  const variants: unknown[] = [];
  for (const name of Object.keys(schema)) {
    for (const value of wrongTypes) {
      variants.push({ ...base, [name]: value });
    }
  }
  return variants;
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
  alternatives: Map<string, readonly unknown[]>
): unknown[] {
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
  ctx: PageContext,
  hostPolicy: object | undefined
): Promise<string> {
  // `BlockRenderResult` is `unknown` on purpose: the engine declares the block
  // contract without depending on React types. This file is inside the React
  // renderer, which is the layer entitled to say what that value is, and a wrong
  // narrowing cannot pass silently — the renderer throws on anything it cannot
  // draw, and `onError` rethrows into the test.
  const node = (await block.render(
    renderArgs(block, props, ctx, hostPolicy)
  )) as ReactNode;
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

/**
 * Tags React may emit ahead of a block's own output.
 *
 * The streaming renderer hoists resource hints and document metadata to the
 * front of the stream regardless of where they were declared, so none of them
 * can be the element a block rendered.
 */
const HOISTED_BY_REACT: ReadonlySet<string> = new Set([
  "link",
  "script",
  "meta",
  "title",
  "style",
  "base",
]);

/**
 * The tags whose inline styles belong to this block's root.
 *
 * The class carriers, PLUS the outermost tag whatever class it holds. A block
 * can wrap its class carrier in a styled element — `<div style><span class=…>` —
 * and that wrapper IS the root the page lays out, so reading only the carrier
 * would find nothing while the forbidden declaration ships on the element above
 * it.
 */
function inspectableTags(html: string): {
  /** Tags whose inline styles belong to this block's root. */
  roots: string[];
  /** Whether the block put its class on anything at all. */
  carriesClass: boolean;
} {
  const tags = html.match(/<[a-zA-Z][a-zA-Z0-9-]*[\s>][^>]*>?/g) ?? [];
  const carriers = tags.filter(tag => {
    const attr = /\sclass="([^"]*)"/i.exec(tag);
    return attr !== null && attr[1].split(/\s+/).includes(NODE_CLASS);
  });
  // React hoists resource hints to the front of the stream, so the first tag in
  // the serialized output can be a `<link rel="preload">` the block never wrote.
  // Taking it as the root leaves a styled wrapper below it uninspected.
  const outermost = tags.find(tag => {
    const name = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag)?.[1]?.toLowerCase();
    return name !== undefined && !HOISTED_BY_REACT.has(name);
  });
  const roots =
    outermost !== undefined && !carriers.includes(outermost)
      ? [outermost, ...carriers]
      : carriers;
  // Both answers come from THIS parse. Asked separately they drift: teaching one
  // about a new serialized shape would leave coverage and the offender scan
  // reading different views of the same output, so a block could be reported
  // reached while its styles went uninspected.
  return { roots, carriesClass: carriers.length > 0 };
}

/**
 * Attribute names are matched case-INSENSITIVELY.
 *
 * HTML attribute names are case-insensitive and React emits an oddly-cased one
 * verbatim: a block spreading `{ STYLE: "padding:24px" }` serializes as
 * `STYLE="padding:24px"`, which a browser applies exactly like `style`. Matching
 * only the lowercase spelling reports that block clean. The captured VALUE is
 * unaffected, so class names stay case-sensitive as CSS requires.
 */
/** The CSS property names an opening tag declares inline. */
function inlinePropertiesOf(tag: string): string[] {
  const attr = /\sstyle="([^"]*)"/i.exec(tag);
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
      for (const hostPolicy of hostPolicies()) {
        const html = await renderHtml(block, props, ctx, hostPolicy);
        const { roots, carriesClass } = inspectableTags(html);
        if (carriesClass) reached = true;
        for (const tag of roots) {
          for (const property of inlinePropertiesOf(tag)) {
            if (permitted.has(property)) continue;
            offenders.push(`${block.name}: ${property}`);
          }
        }
      }
    }
  }
  return { reached, offenders };
}

/**
 * Blocks that do the thing this file forbids, each reachable by a different
 * part of the detector.
 *
 * One probe is not enough, and the reason is the same one that motivates the
 * rule itself: a probe carrying the class and the style on the SAME element is
 * found by the carrier lookup alone, so a detector that stopped resolving
 * components, or stopped inspecting the wrapper above the carrier, or stopped
 * matching an oddly-cased attribute, would keep finding it and report clean for
 * every block that evaded the part which broke. Each probe here fails for a
 * reason none of the others can.
 */
const PROBES: {
  label: string;
  block: AnyBlockDefinition;
  property: string;
}[] = [
  {
    label: "a style behind a component",
    property: "color",
    // Visible only once components are resolved: reading the returned element's
    // own props finds a class and no style.
    block: {
      name: "test/probe-component",
      version: 1,
      example: { props: {} },
      render: ({ className }: { className: string }) => {
        const Root = (inner: { className: string }) => (
          <div className={inner.className} style={{ color: "red" }}>
            probe
          </div>
        );
        return <Root className={className} />;
      },
    } as unknown as AnyBlockDefinition,
  },
  {
    label: "a styled wrapper around a clean carrier",
    property: "color",
    // The class sits on a NESTED element while the style sits on the wrapper
    // above it, which is the element a page lays out. A carrier-only lookup
    // finds the class, finds no style, and reports the block clean.
    block: {
      name: "test/probe-wrapper",
      version: 1,
      example: { props: {} },
      render: ({ className }: { className: string }) => (
        <div style={{ color: "red" }}>
          <span className={className}>probe</span>
        </div>
      ),
    } as unknown as AnyBlockDefinition,
  },
  {
    label: "an odd-cased style attribute",
    property: "padding",
    // React preserves an unknown prop's spelling and HTML attribute names are
    // case-insensitive, so this ships as a live inline style that a
    // lowercase-only match cannot see.
    block: {
      name: "test/probe-uppercase",
      version: 1,
      example: { props: {} },
      render: ({ className }: { className: string }) =>
        createElement("div", {
          className,
          ...({ STYLE: "padding:24px" } as Record<string, string>),
        }),
    } as unknown as AnyBlockDefinition,
  },
];

describe("the detector itself", () => {
  it.each(PROBES.map(probe => [probe.label, probe] as const))(
    "reports %s, so an empty result means clean",
    async (_label, probe) => {
      // Every other assertion in this file is satisfied by finding nothing, and
      // reachability is decided by the class lookup alone — so a parser or an
      // aggregation that regressed to returning nothing would leave them all
      // green. Each probe drives a block that IS in breach through this path.
      const { reached, offenders } = await inspectBlock(probe.block);

      expect(reached).toBe(true);
      // Deduped, as the library assertion is: a block is rendered once per host
      // state and per prop variant, so one breach is reported once per case.
      expect([...new Set(offenders)]).toEqual([
        `${probe.block.name}: ${probe.property}`,
      ]);
    }
  );
});

describe("a core block's root element", () => {
  it("carries no inline style, and every block was actually reached", async () => {
    const results = await Promise.all(
      coreBlocks.map(async block => {
        const definition = block as AnyBlockDefinition;
        return { name: definition.name, ...(await inspectBlock(definition)) };
      })
    );

    // The exact set, not a floor. A minimum of ten is still met after one or
    // two blocks are dropped from the export, and the reachability check below
    // only ever examines what remains — so coverage would fall silently while
    // both assertions stayed green. Naming them makes a deletion a failure and
    // an addition a deliberate edit here.
    expect(results.map(result => result.name).sort()).toEqual(EXPECTED_BLOCKS);

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
