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
  "core/accordion",
  "core/accordion-item",
  "core/card",
  "core/collection-loop",
  "core/column",
  "core/columns",
  "core/divider",
  "core/embed",
  "core/form",
  "core/gallery",
  "core/heading",
  "core/image",
  "core/list",
  "core/quote",
  "core/rich-text",
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
  // A host answering RICHLY, in two ways the single-row, fully-described
  // `answering` host cannot: more than one row, and a media record carrying no
  // intrinsic size. Both are ordinary — a query usually returns several entries,
  // and `ResolvedMedia` declares `width` and `height` optional because a library
  // that never captured them is a normal library.
  //
  // Combined on ONE host rather than split across two, because that is the shape
  // a real host has and doubling the context list doubles every render. What it
  // does not separate is a block branching on multiple rows AND a fully
  // described record at once; the single-row host describes its record fully, so
  // that pair is reachable from neither.
  const answeringRichly = {
    ...answering,
    data: {
      find: () =>
        Promise.resolve({
          // One numeric id, because `keyFor` names `typeof id === "number"` as
          // a supported case and a collection on numeric primary keys is an
          // ordinary collection. All-string rows leave that path unrendered.
          items: [
            { id: "e1", title: "An entry" },
            { id: 2, title: "Another entry" },
          ],
          total: 2,
        }),
    },
    // No `alt` and no dimensions. Both are optional on `ResolvedMedia`, and
    // `renderImage` has a distinct fallback for each — a library that captured
    // neither is an ordinary library, not a malformed one.
    resolveMedia: () =>
      Promise.resolve({ id: "m2", url: "https://example.com/y.png" }),
  };
  // One dimension without the other. `renderImage` spreads `width` and `height`
  // through SEPARATE conditionals, so the two are independent branches and a
  // record carrying one is as valid as a record carrying both or neither — a
  // library that measured an image and lost one field is the ordinary way to
  // get here. Two hosts rather than one, because a single record cannot be
  // width-only and height-only at the same time.
  const widthOnlyMedia = {
    ...answering,
    resolveMedia: () =>
      Promise.resolve({
        id: "m3",
        url: "https://example.com/w.png",
        alt: "w",
        width: 640,
      }),
  };
  const heightOnlyMedia = {
    ...answering,
    resolveMedia: () =>
      Promise.resolve({
        id: "m4",
        url: "https://example.com/h.png",
        alt: "h",
        height: 480,
      }),
  };
  const budgetSpent = { ...answering, queries: { take: () => false } };
  const budgetAvailable = { ...answering, queries: { take: () => true } };
  // The shape a ROUTED page actually has. `createStandaloneContext` is called
  // once with both the locale and the query budget on it, so varying the two on
  // separate contexts exercises each axis and never the state every real routed
  // render is in — a block branching on the pair sees neither of the single-axis
  // contexts. Both budget answers appear, because a localized page that has
  // spent its allowance and one that has not take different paths.
  const localizedBudgetSpent = { ...localized, queries: { take: () => false } };
  const localizedBudgetAvailable = {
    ...localized,
    queries: { take: () => true },
  };
  return [
    empty,
    answering,
    noProvider,
    failing,
    rejecting,
    localized,
    budgetSpent,
    budgetAvailable,
    localizedBudgetSpent,
    localizedBudgetAvailable,
    answeringRichly,
    widthOnlyMedia,
    heightOnlyMedia,
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
    // Fetch permission and frame trust are SEPARATE grants, and the policies
    // above move them together — so `embed` never reaches the state where a url
    // is fetchable but its origin is not trusted. It refuses an unfetchable url
    // by returning null (`embed.tsx:65`) BEFORE `isTrustedOrigin` is consulted,
    // so a policy that refuses the host answers the sandbox question by never
    // asking it. Permitting the fetch and withholding the trust is the only
    // arrangement that reaches the restricted-sandbox branch.
    {
      remotePatterns: [{ protocol: "https", hostname: "example.com" }],
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
    // Required by the render contract; these fixtures declare no parts.
    partClass: () => "",
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
/**
 * Values a stored node can hold that the schema's OWN bounds exclude.
 *
 * A declared range describes what the editor offers, not what the row contains.
 * Nothing revalidates a stored document against a later schema, so a node
 * written before a bound existed, migrated, or hand-edited arrives outside it —
 * and blocks carry explicit code for exactly that. `core/collection-loop` says
 * so in as many words and clamps in `safeLimit`, so a fixture staying inside
 * `1..100` renders the clamp inert and every branch behind it unreached.
 *
 * Derived from each entry's own bounds rather than listed, so a block that
 * declares a range gets its edges exercised without an edit here. `Math.floor`
 * earns the non-integer: a stored number is not obliged to be whole.
 */
function outOfRangeValuesFor(entry: Record<string, unknown>): unknown[] {
  if (entry.type !== "number") return [];
  const min = typeof entry.min === "number" ? entry.min : 1;
  const max = typeof entry.max === "number" ? entry.max : 100;
  return [
    0,
    -1,
    min - 1,
    max + 1,
    min + 0.5,
    // A bound the SCHEMA never declared. A renderer applies caps of its own —
    // `core/list` clamps `start` to a million while its schema names only a
    // minimum — so edges derived from the schema alone stop short of the value
    // that actually selects the branch. Anything past the largest exactly
    // representable integer is beyond every such cap without guessing which
    // one a given block chose, which the two lines above cannot avoid doing.
    Number.MAX_SAFE_INTEGER,
    -Number.MAX_SAFE_INTEGER,
  ];
}

/**
 * Arrays whose MEMBERS are malformed, which a wrong top-level type cannot reach.
 *
 * `malformedVariants` replaces a whole prop, so an array prop becomes a number
 * or null and the member-handling code is skipped entirely. A stored array with
 * a member of the wrong type is a different state, and the one `core/list`
 * coerces per item — `stored.slice(...).map(item => text(item))` exists for it.
 *
 * A member of the wrong TYPE is a value alternative like any other, so these
 * belong in the cross product. An oversized array is not — see
 * `oversizedArrayVariants`.
 */
function malformedMemberArraysFor(entry: Record<string, unknown>): unknown[] {
  if (entry.type !== "array") return [];
  return [[42], [null], [{}], ["ok", 42]];
}

/**
 * One prop set per array prop, sized past the renderer's own truncation.
 *
 * `core/list` slices at a thousand before it maps, and that slice is a branch
 * like any other: a stored array can be any length, and nothing in the schema
 * says otherwise. Sized just over the cap rather than far past it, so the branch
 * is reached at the smallest input that reaches it.
 *
 * Held OUTSIDE `alternativesFor`, which is what keeps this affordable, and the
 * distinction is about what the value probes rather than about its cost. The
 * alternatives are crossed with each other — layered into conjunctions, then
 * fanned out through the omitted and sole passes. A prop set carrying a thousand
 * items costs about two orders of magnitude more per render than any other, so
 * the clamp in `layeredVariants` — which repeats a short alternative list's LAST
 * value into every later layer — was pinning the oversized array into layer
 * after layer and then fanning each one out again.
 *
 * This pass is the base case: one prop set per array prop, crossed with every
 * host state and policy. That crossing is the part not traded away, because a
 * block whose truncated output branches on the host would otherwise go
 * unrendered.
 *
 * Pairing the oversized array with the OTHER props is still needed and is not
 * done here — see `oversizedConjunctions`, which derives its cases from these
 * and runs them against a single host state. The two together cost about what
 * one of the old fanned-out layers did.
 */
/**
 * An oversized array paired with each alternative the OTHER props can take.
 *
 * The base-spread case in {@link oversizedArrayVariants} holds every other prop
 * at its example value, so a style written only when the array is past the cap
 * AND another prop is away from that value is never rendered — `core/list`
 * examples an unordered list, so a declaration guarded by
 * `items.length > MAX && kind === "ordered"` is not reached by it.
 *
 * One prop moved at a time, not the cross product, which is the same bound the
 * single-prop pass uses. What that leaves uncovered is a style needing the
 * oversized array and TWO other props away from base at once.
 */
/**
 * A block's props as every pass starts from them: its defaults, with its
 * example spread over the top.
 *
 * One definition, because three passes need it and a second copy is a second
 * answer to what "unmodified" means for a block.
 */
function baseProps(block: AnyBlockDefinition): Record<string, unknown> {
  return {
    ...(block.defaultProps ?? {}),
    ...(block.example.props ?? {}),
  } as Record<string, unknown>;
}

function oversizedConjunctions(block: AnyBlockDefinition): unknown[] {
  const schema: Record<string, unknown> = block.props ?? {};
  const alternatives = alternativesFor(schema);

  // DERIVED from the base-spread cases rather than rebuilt beside them. Both
  // passes answer one question — what does this block do when an array is past
  // the renderer's cap — and rediscovering the array props, the base, and the
  // oversized length here would be a second definition of it. They agree today;
  // a later change to any of the three would move one and leave the other
  // exercising inputs the first no longer uses.
  return oversizedArrayVariants(block).flatMap(oversized => {
    const set = oversized as Record<string, unknown>;
    // Which prop this case made oversized, read back off the case itself: it is
    // the array long enough to have passed the cap, and its own alternatives
    // must not overwrite it.
    const arrayName = Object.keys(set).find(
      name => Array.isArray(set[name]) && (set[name] as unknown[]).length > 1000
    );
    return [...alternatives]
      .filter(([name]) => name !== arrayName)
      .flatMap(([name, values]) =>
        values.map(value => ({ ...set, [name]: value }))
      );
  });
}

function oversizedArrayVariants(block: AnyBlockDefinition): unknown[] {
  const base = baseProps(block);
  const schema: Record<string, unknown> = block.props ?? {};
  return Object.entries(schema)
    .filter(([, entry]) => (entry as { type?: unknown }).type === "array")
    .map(([name]) => ({
      ...base,
      [name]: Array.from({ length: 1001 }, (_, index) => `i${index}`),
    }));
}

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
    const record = entry as Record<string, unknown>;
    const stored = [
      ...(values ?? []),
      ...outOfRangeValuesFor(record),
      ...malformedMemberArraysFor(record),
    ];
    if (stored.length > 0) alternatives.set(name, stored);
  }
  return alternatives;
}

/**
 * Prop sets with one declared prop MISSING, which no other variant produces.
 *
 * Every other case spreads over a base built from the defaults and the example,
 * so a prop either block declares is present in all of them — and "absent" is a
 * third state that neither a value nor a malformed value reaches. Blocks branch
 * on it directly: `core/image` emits the media record's alt text only when the
 * node authored none, and `isAuthoredText` counts an empty string as authored,
 * so an example carrying `alt: ""` keeps that path unreached just as firmly as
 * one carrying a sentence.
 *
 * A stored document reaches this state the ordinary way — a prop added to a
 * block after the node was written, or one the author never filled in.
 *
 * Applied to the LAYERED sets as well as to the base, because absence usually
 * only matters in company: `core/image` reaches its record-alt fallback when a
 * media id resolves AND no alt was authored, and the base carries no media id,
 * so omitting `alt` from it alone leaves the branch as unreached as before.
 */
function omittedVariants(
  sets: readonly Record<string, unknown>[],
  schema: Record<string, unknown>
): unknown[] {
  const variants: unknown[] = [];
  for (const set of sets) {
    for (const name of Object.keys(schema)) {
      if (!(name in set)) continue;
      const variant = { ...set };
      delete variant[name];
      variants.push(variant);
    }
  }
  return variants;
}

/**
 * Prop sets carrying exactly ONE declared prop, with every other one absent.
 *
 * `omittedVariants` removes a single prop at a time, so it cannot produce the
 * states that need two or more absent together — and blocks branch on those.
 * `core/quote` renders a bare `<blockquote>` carrying the class only when
 * attribution AND source are both empty, and a cite URL on that branch is a
 * coherent, ordinary document: a quotation with a source link and nobody named.
 * The base carries an attribution, so no single omission reaches it.
 *
 * Bounded at one variant per declared prop rather than every subset, which
 * would be exponential. What that leaves uncovered is a branch needing a
 * specific PAIR of props present while a third is absent.
 */
function soleVariants(
  base: Record<string, unknown>,
  schema: Record<string, unknown>
): unknown[] {
  return Object.keys(schema)
    .filter(name => name in base)
    .map(name => ({ [name]: base[name] }));
}

/** The prop sets each block is exercised with. */
function propVariants(block: AnyBlockDefinition): unknown[] {
  const base = baseProps(block);
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
  const layered = layeredVariants(base, alternatives) as Record<
    string,
    unknown
  >[];
  return [
    ...variants,
    ...layered,
    ...omittedVariants([base, ...layered], schema),
    ...soleVariants(base, schema),
    ...layered.flatMap(layer => soleVariants(layer, schema)),
    ...malformedVariants(base, schema),
    ...oversizedArrayVariants(block),
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
    // Streaming, because React splits its output at byte boundaries that need
    // not be character boundaries: a multi-byte character straddling two chunks
    // decodes to replacement characters when each chunk is treated as complete
    // input, which corrupts exactly the block text most likely to be localized.
    html += decoder.decode(value, { stream: true });
  }
  // Flushes anything the decoder still holds from a trailing partial sequence,
  // which would otherwise be dropped from the inspected markup.
  html += decoder.decode();
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

  const inspect = async (
    props: unknown,
    ctx: PageContext,
    hostPolicy: object | undefined
  ): Promise<void> => {
    const html = await renderHtml(block, props, ctx, hostPolicy);
    const { roots, carriesClass } = inspectableTags(html);
    if (carriesClass) reached = true;
    for (const tag of roots) {
      for (const property of inlinePropertiesOf(tag)) {
        if (permitted.has(property)) continue;
        offenders.push(`${block.name}: ${property}`);
      }
    }
  };

  for (const props of propVariants(block)) {
    for (const ctx of contexts()) {
      for (const hostPolicy of hostPolicies()) {
        await inspect(props, ctx, hostPolicy);
      }
    }
  }

  // The oversized cases run against ONE host state rather than all of them, and
  // the split is what makes them affordable. A prop set carrying a thousand
  // items costs about two orders of magnitude more per render than any other,
  // so crossing every one of them with thirteen host states and four policies
  // spends the whole file's budget on a single block.
  //
  // What that gives up is a style conditional on length AND a host state at
  // once. This file already declines the equivalent elsewhere — `layeredVariants`
  // is bounded by the widest prop rather than the cross product, and
  // `soleVariants` moves one prop at a time — so a three-way conjunction is
  // outside what any of these passes reach, and length is the axis where paying
  // for it is most expensive.
  const [ctx] = contexts();
  const [hostPolicy] = hostPolicies();
  for (const props of oversizedConjunctions(block)) {
    await inspect(props, ctx!, hostPolicy);
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
    // Reachable ONLY through the oversized-conjunction pass, which is what
    // gives that pass a control of its own. Every other probe here declares an
    // empty schema and writes its style unconditionally, so the base variant
    // loop finds all of them — and a conjunction pass that returned nothing
    // would leave this suite green while the coverage it adds was gone.
    //
    // The style needs BOTH an array past the renderer's cap and another prop
    // away from its example value, which is exactly the shape the base-spread
    // case cannot reach: it holds every other prop at that value.
    label: "a style needing an oversized array and a non-base prop",
    property: "color",
    block: {
      name: "test/probe-oversized-conjunction",
      version: 1,
      props: {
        items: { type: "array", of: "text" },
        kind: { type: "select", options: ["unordered", "ordered"] },
      },
      defaultProps: { kind: "unordered", items: [] },
      example: { props: { kind: "unordered", items: ["one"] } },
      render: ({
        props,
        className,
      }: {
        props: { items?: unknown; kind?: unknown };
        className: string;
      }) => {
        const items = Array.isArray(props.items) ? props.items : [];
        const conditional =
          items.length > 1000 && props.kind === "ordered"
            ? { style: { color: "red" } }
            : {};
        return <div className={className} {...conditional} />;
      },
    } as unknown as AnyBlockDefinition,
  },
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
    label: "a styled wrapper behind a hoisted resource tag",
    property: "color",
    // The control for `HOISTED_BY_REACT` itself, which nothing else exercises:
    // every other probe renders only `div`/`span`, so React emits no resource
    // hint and the skip-list is never consulted. React moves `title` to the
    // front of the stream regardless of where it sits in the tree, so the first
    // tag serialized here is one the block did not write.
    //
    // The style sits on the WRAPPER rather than on the carrier deliberately. A
    // breach on the carrier is found by the class lookup whether or not the
    // skip-list works, so it could not distinguish them; with the style one
    // level up, locating the root is the only way to see it, and that is
    // exactly what the hoisted tag would displace.
    block: {
      name: "test/probe-hoisted",
      version: 1,
      example: { props: {} },
      render: ({ className }: { className: string }) => (
        <>
          {/* Two hoisted kinds, because the skip-list has several entries and
              a probe authoring one protects only that entry: an eager image
              makes React INJECT a preload `<link>` nobody wrote, which is the
              entry a hand-authored tag cannot exercise. The image sits INSIDE
              the wrapper so the wrapper remains the outermost written tag. */}
          <title>probe</title>
          <div style={{ color: "red" }}>
            <span className={className}>probe</span>
            <img src="https://example.com/p.png" alt="" fetchPriority="high" />
          </div>
        </>
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

/**
 * The per-block budget for one block's whole render matrix.
 *
 * Every host state, host policy and prop variant for a single block, which grows
 * as those sets grow rather than staying fixed. Vitest's default is a limit on
 * the MACHINE rather than on the code: the work is CPU-bound server rendering,
 * and a runner executing several matrix legs at once is far slower than a
 * developer's. An explicit budget keeps a red meaningful — this should fail
 * because a block wrote an inline style, never because a runner was busy.
 */
const PER_BLOCK_RENDER_TIMEOUT_MS = 60_000;

describe("a core block's root element", () => {
  // The exact set, not a floor, and asserted WITHOUT rendering anything. A
  // minimum of ten is still met after one or two blocks are dropped from the
  // export, and a per-block case only ever runs for what remains — so coverage
  // would fall silently while every rendering case stayed green. Naming them
  // makes a deletion a failure here and an addition a deliberate edit.
  //
  // Separate from the render cases deliberately: this is the ratchet, it costs
  // nothing, and it must still fail when a block is removed rather than
  // disappearing along with the case that would have caught it.
  it("is drawn from exactly the expected block library", () => {
    expect(
      coreBlocks.map(block => (block as AnyBlockDefinition).name).sort()
    ).toEqual(EXPECTED_BLOCKS);
  });

  // One case PER BLOCK rather than one case over all of them. A single case
  // carries the whole matrix under one budget, so a slow runner fails it for a
  // reason unrelated to the invariant and the report names no block; split, each
  // block is bounded on its own, the failure names which block wrote the style,
  // and the runner schedules the cases against its own concurrency limit instead
  // of twelve unbounded chains started at once.
  it.each(
    coreBlocks.map(
      block => [(block as AnyBlockDefinition).name, block] as const
    )
  )(
    "%s carries no inline style, and was actually reached",
    async (name, block) => {
      const { reached, offenders } = await inspectBlock(
        block as AnyBlockDefinition
      );

      // The vacuity control. Without it a block that stopped rendering entirely
      // reports no offenders and reads exactly like a clean one.
      expect(reached, `${name} was never rendered`).toBe(true);

      expect(
        [...new Set(offenders)].sort(),
        "A block wrote an inline style on the element it was given a class for. " +
          "An inline declaration beats every class rule, so a style control " +
          "writing that property compiles CSS with no visible effect. Move the " +
          "default to `baseStyles`, which the compiler emits as the block-type " +
          "tier beneath the node's own values."
      ).toEqual([]);
    },
    PER_BLOCK_RENDER_TIMEOUT_MS
  );
});
