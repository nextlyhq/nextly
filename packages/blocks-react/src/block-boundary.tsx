import {
  blockPartClassName,
  blockTypeClassName,
  type BlockNode,
  type ComponentUnresolvedReason,
  type ResolvedBlockNode,
} from "@nextlyhq/blocks-engine";
import { Suspense, cloneElement, isValidElement, type ReactNode } from "react";

import type { BlockHostPolicy, PageContext } from "./context";
import { BlockPlaceholder } from "./placeholder";
import {
  createsNoHostElement,
  describeThrown,
  isThenable,
  normalizeRenderable,
} from "./renderable";
import type { BlockResolver } from "./resolver";
import { isUnconditional } from "./visibility";

/**
 * What an author is told when a component did not load.
 *
 * Wording per cause, because the remedies are five different things and a
 * single message would send an author looking in the wrong place for four of
 * them. Development only: the production placeholder renders nothing.
 */
const UNRESOLVED_DETAIL: Readonly<Record<ComponentUnresolvedReason, string>> = {
  missing: "No published component was found for this reference",
  cycle: "This component contains itself",
  "composed-depth": "This component is nested inside too many components",
  "node-depth": "This component's own content is nested too deeply",
  budget: "This page is already at its node limit",
  malformed: "This instance names no component",
};

/** What a render needs to turn one node into output. */
export interface BlockBoundaryProps {
  /**
   * A node of the RESOLVED tree. Widened from `BlockNode` rather than narrowed
   * to it: every stored node already satisfies this, so no caller changes, and
   * the boundary is the one place that has to tell a composed node apart from
   * an authored one.
   */
  node: ResolvedBlockNode;
  context: PageContext;
  blocks: BlockResolver;
  /** Node id to generated class, from the compiled stylesheet. */
  classes: Record<string, string>;
  /** Shown while an async block is still producing output. */
  fallback?: ReactNode;
  /**
   * Site-operator decisions the block enforces.
   *
   * Threaded down the tree rather than carried on the context, so the host's
   * own object is never rewritten and no block can supply its own.
   */
  hostPolicy?: BlockHostPolicy;
  /**
   * Emit `data-nx-node="<node id>"` on each block's root element.
   *
   * OFF by default: a published page should not carry editor concerns, which is
   * the same reason Gutenberg emits its `data-block` in the editor and not in
   * post content. An editor turns it on and gets a stable address per node.
   *
   * It is the ONLY per-node hook that reaches the DOM independently of styling.
   * The scoped class does not: `classNameFor` returns the block-TYPE class alone
   * for a node with no compiled styles, so hit-testing on the class cannot
   * address an unstyled node and would resolve to the wrong one.
   */
  nodeAttribute?: boolean;
}

/**
 * The classes a block puts on its own root element.
 *
 * Two, not one. The node's own class carries what was set on this instance; the
 * block-type class carries the shared defaults the compiler emits once per type
 * rather than copying into every node. A block given only its node class loses
 * every default its type defines.
 */
function classNameFor(
  node: BlockNode,
  classes: Record<string, string>
): string {
  const nodeClass = classes[node.id];
  const typeClass = blockTypeClassName(node.type);
  return nodeClass ? `${nodeClass} ${typeClass}` : typeClass;
}

/**
 * A slot's children, or nothing when the stored value is not a list.
 *
 * Documents are JSON round-tripped through a database, so a slot can hold
 * whatever was written there. Passing a malformed value on would put
 * `nodes.map` inside React's render, past the boundary that called the block,
 * and one bad field would cost the page rather than the slot.
 */
function slotNodes(node: BlockNode, name: string): BlockNode[] {
  const stored = node.slots?.[name];
  return Array.isArray(stored) ? stored : [];
}

/**
 * Inert global attributes an author may set on a block's root element.
 *
 * An ALLOWLIST, not a list of things to refuse. The engine's validator rejects
 * `on*` handlers and says in as many words that the render-safe list belongs to
 * the renderer — so this is the only place it exists, and a list of refusals
 * could never keep up. `srcDoc` injects a document, `href`/`formAction`/`action`
 * choose a destination, `src` and `poster` fetch, `style` and `class` restyle,
 * and the next attribute with reach ships in some future browser without anyone
 * here noticing.
 *
 * These four carry no behaviour: they name, describe or orient an element.
 * `id` arrives separately through the modelled `cssId` field.
 */
const ALLOWED_ATTRIBUTE_NAMES = new Set(["id", "title", "lang", "dir"]);

/**
 * A name HTML can carry, which is the XML `Name` production.
 *
 * Mirrors React's own attribute-name validation rather than a narrower rule of
 * this project's own: refusing a name React WOULD render is a false alarm on
 * correct input, and this predicate is what an editor asks before telling an
 * author their attribute is unusable. The unicode ranges are that production's,
 * so a non-ASCII `data-` name is accepted exactly where the DOM accepts it.
 */
/** The first character of an XML `Name`. */
const NAME_START =
  "[:A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD]";

/**
 * Every LATER character, combining ranges first.
 *
 * Order matters only to a reader: with a base character immediately before a
 * combining range, the two read as one combined character rather than as two
 * alternatives, and a linter says so. Leading with the combining ranges keeps
 * the set identical and the intent unambiguous.
 */
const NAME_CHAR =
  "[\\u0300-\\u036F\\u203F-\\u2040\\u00B7\\-.0-9:A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD]";

const ATTRIBUTE_NAME = new RegExp(`^${NAME_START}${NAME_CHAR}*$`, "u");

/**
 * Whether an author-supplied attribute may reach the DOM.
 *
 * `data-*` and `aria-*` are open by prefix: both are namespaces defined to carry
 * author data and accessibility semantics, neither can name a destination or
 * execute anything, and closing them would defeat the feature the field exists
 * for. `role` is the ARIA sibling of `aria-*` and belongs with them.
 *
 * EXPORTED so an editor offering this field can ask it rather than restate it.
 * The list above already says the render-safe set lives here and only here; a
 * second copy in an editor would drift, and it would drift silently in the
 * worse direction — the editor accepting a name this loop then skips, so the
 * author sets an attribute, sees it saved, and never sees it on the page.
 */
export function isAllowedAttribute(name: string): boolean {
  // SYNTAX first, because the open prefixes below admit anything after them.
  // `data-x foo` and `data-x"` start with `data-` and are not attribute names:
  // React refuses them and renders nothing, so a check that stopped at the
  // prefix let a value be stored that could never appear on a page.
  if (!ATTRIBUTE_NAME.test(name)) return false;
  const lower = name.toLowerCase();
  if (lower === "role") return true;
  if (lower.startsWith("data-") || lower.startsWith("aria-")) return true;
  return ALLOWED_ATTRIBUTE_NAMES.has(lower);
}

/**
 * Applies the node's root-level HTML fields to what the block rendered.
 *
 * `cssId` and `attributes` belong to the NODE, not the block, and
 * `BlockRenderArgs` carries only `className` — so a block has no way to receive
 * them and they would be stored and silently dropped, breaking anchors, labels
 * and author data attributes.
 *
 * Applied by cloning because the block owns its root element: the format says a
 * block renders a single element and never wraps it, so its root IS the node's
 * root. Output that is not a single element has no root to carry them and is
 * returned untouched rather than guessed at.
 */
/** The attribute an editor addresses a node by. Named, so one string decides it. */
export const NODE_ID_ATTRIBUTE = "data-nx-node";

/**
 * The attribute naming which prop an element renders, for an editor.
 *
 * Written only when the editor asked for node addresses, so a published page
 * carries none of it — the same condition {@link NODE_ID_ATTRIBUTE} rides on,
 * because the two answer one question together: an editor needs to know which
 * node it is looking at AND which of that node's values an element holds, and
 * either alone addresses nothing.
 */
export const PROP_ATTRIBUTE = "data-nx-prop";

/**
 * Marks a block whose definition declares at least one slot.
 *
 * The editor needs to find containers without knowing their names: a list of
 * built-in types would exclude every container a plugin contributes, and would
 * have to be kept in step with packages this one does not own. Whether a block
 * declares slots is the structural fact underneath that list, and it is
 * available here for nothing.
 *
 * Rides `nodeAttribute` for the same reason {@link NODE_ID_ATTRIBUTE} does: it
 * is the editor's own namespace and has no business on a published page.
 */
export const SLOTS_ATTRIBUTE = "data-nx-slots";

/**
 * The prefix every marker the editor puts on a rendered element shares.
 *
 * A NAMESPACE rather than a list, because a list is a thing to keep in sync
 * and this one already fell behind once: three markers exist and only the
 * node id was protected here. Anything a future overlay needs is covered by
 * construction.
 */
export const EDITOR_NAMESPACE = "data-nx-";

/**
 * Builds the `markProp` a block spreads onto the element carrying a value.
 *
 * Returns nothing at all outside an editor, and nothing for a prop the block
 * has not declared `inline` — so the declaration and the marking have to agree
 * before an editor sees anything, and a block that marks an element it never
 * declared gets silence rather than an editable region nobody intended.
 */
function propMarker(
  definition: { props?: Record<string, { inline?: boolean } | undefined> },
  enabled: boolean
): ((name: string) => Record<string, string>) | undefined {
  if (!enabled) return undefined;
  return (name: string): Record<string, string> => {
    if (definition.props?.[name]?.inline !== true) return {};
    return { [PROP_ATTRIBUTE]: name };
  };
}

/**
 * Applies the two editor-only markers to an element's attribute bag, in the
 * order that keeps the node address last.
 *
 * Split out of `withNodeAttributes` so the two markers read as one small,
 * obviously-total step: every branch here is gated on `nodeAttribute`, so
 * this function's own count stays fixed regardless of how many editor
 * markers exist, while the merge of author-set fields in `withNodeAttributes`
 * is where that function's complexity actually comes from.
 */
function applyEditorMarkers(
  extra: Record<string, string>,
  node: BlockNode,
  nodeAttribute: boolean,
  declaresSlots: boolean
): void {
  // Before the node address rather than after it, so the two editor markers
  // sit together and the "LAST, so it cannot be overwritten" reasoning below
  // still describes the line it is attached to.
  if (nodeAttribute && declaresSlots) extra[SLOTS_ATTRIBUTE] = "";
  /*
   * LAST, so it cannot be overwritten. This was written first, with a
   * comment saying that made it safe — the opposite of what the code did:
   * the author's loop in `withNodeAttributes` ran afterwards and assigning
   * the same key simply replaced it. A document could therefore hand every
   * block the same address, or one block another's, and the editor's
   * hit-testing reads exactly this value to decide which block was clicked.
   *
   * It is the editor's address for a node, not a value the document may
   * set, so the position enforces that rather than a note asking the loop
   * above to.
   */
  if (nodeAttribute) extra[NODE_ID_ATTRIBUTE] = node.id;
}

function withNodeAttributes(
  output: ReactNode,
  node: BlockNode,
  nodeAttribute = false,
  // Whether the block's definition declares at least one slot, decided once by
  // the caller and carried down rather than re-read from the definition here.
  declaresSlots = false
): ReactNode {
  const cssId = typeof node.cssId === "string" ? node.cssId : undefined;
  // A stored envelope is whatever the database returned: `attributes: null`
  // reaches `Object.keys` and throws here, after the render try/catch and after
  // normalization, so one bad persisted field would cost the page.
  const attributes =
    typeof node.attributes === "object" &&
    node.attributes !== null &&
    !Array.isArray(node.attributes)
      ? node.attributes
      : undefined;
  const hasAttributes =
    attributes !== undefined && Object.keys(attributes).length > 0;
  // The node-id attribute is applied UNCONDITIONALLY when asked for, which is
  // why it is checked before this early return rather than added to the
  // allowlist loop below. That return fires for any node carrying no `cssId`
  // and no `attributes` — which is nearly every node on a real page — so an
  // editor address joined to the loop would land on almost nothing while a
  // fixture that happened to set either field passed.
  if (cssId === undefined && !hasAttributes && !nodeAttribute) return output;
  if (!isValidElement(output)) return output;
  // Only a host element has a DOM root to carry them. `nodeRootReason` has
  // already refused the combination that would land here otherwise, so this is
  // the invariant restated rather than a second policy.
  if (typeof output.type !== "string") return output;

  const extra: Record<string, string> = {};
  if (attributes) {
    for (const [name, value] of Object.entries(attributes)) {
      if (!isAllowedAttribute(name)) continue;
      // Lowercased before use. HTML attribute names are ASCII case-insensitive,
      // but React treats `ID` and `id` as different props — so a case variant
      // would survive the allowlist and then be rendered ALONGSIDE the modelled
      // `cssId`, leaving two id attributes on one element.
      const key = name.toLowerCase();
      // The field is typed as strings and sanitized at write time, but a stored
      // document can hold anything; a non-string would be handed to React as a
      // prop value it never expected.
      if (typeof value !== "string") continue;
      /*
       * The editor's own namespace is not the document's to write, and only
       * while this render is FOR the editor: on a published page these are
       * ordinary author data and none of this system's business.
       *
       * Filtered HERE rather than trusted to the panel that offers the field.
       * A document can arrive from an import or a script, and the marker it
       * would overwrite decides which block a click selects and which
       * property inline editing commits into.
       */
      if (nodeAttribute && key.startsWith(EDITOR_NAMESPACE)) continue;
      extra[key] = value;
    }
  }
  // The modelled field wins over an attribute of the same name: `cssId` is what
  // the editor writes, and the attribute bag is the escape hatch beside it.
  if (cssId !== undefined) extra.id = cssId;
  applyEditorMarkers(extra, node, nodeAttribute, declaresSlots);

  return Object.keys(extra).length > 0 ? cloneElement(output, extra) : output;
}

/**
 * Whether this value is one this renderer can see draws nothing.
 *
 * Answers ONLY for output this renderer owns, and that limit is the design
 * rather than an omission. `normalizeRenderable` materialises an iterable a
 * block returns into a fresh array, so what arrives here is the very object
 * React will render and no author code runs to produce it.
 *
 * The set of primitives is exact rather than a nullish check: `false` is what
 * the ordinary conditional form `enabled && <div />` yields when disabled, and
 * an empty string is what a cleared text value becomes. `0` is deliberately
 * absent — React renders it as the character zero, which is real output with no
 * element to carry the node's fields.
 *
 * An array is walked BY INDEX, which is how React reads one. Following an
 * array's own `Symbol.iterator` would answer a question React never asks, and a
 * custom one can disagree with the indexed contents.
 *
 * Anything reached through an element the block built is NOT judged here. Its
 * children, its props and any iterator inside it belong to the author and are
 * read again by React after this returns, so nothing read from them can be
 * relied on. A block that draws nothing from such a root declares it instead.
 */
function rendersNothing(output: unknown, budget = { left: 10_000 }): boolean {
  // A LIST this renderer owns. `normalizeRenderable` materialises an iterable a
  // block returns into a fresh array, so this walks the very object React will
  // render and no author code runs to produce it.
  //
  // Arrays only, and only owned ones. The array's own `Symbol.iterator` is not
  // used — React renders an array by its indexed contents, and following a
  // custom iterator would answer a question React never asks.
  if (Array.isArray(output)) {
    for (let index = 0; index < output.length; index += 1) {
      // Refusing when the budget runs out answers "it draws", which is the safe
      // direction: it keeps the node's fields refused rather than silently
      // accepting output nobody counted.
      if (budget.left-- <= 0) return false;
      if (!rendersNothing(output[index], budget)) return false;
    }
    return true;
  }
  return (
    output === null ||
    output === undefined ||
    typeof output === "boolean" ||
    output === ""
  );
}

/**
 * Why a node's root-level fields cannot reach the element the block returned.
 *
 * `cssId` and `attributes` are DOM props and only a host element has a DOM root
 * to put them on. A block whose root is a fragment, `StrictMode`, `Suspense` or
 * `Activity` renders no element of its own, so React drops the props — without
 * throwing, and in production without saying anything. What is lost is an
 * anchor target, a `label for=`, an `#id` selector: navigation and styling that
 * silently stop working, on a page that otherwise looks correct.
 *
 * So the combination is refused rather than half-applied. It is only reachable
 * when the document actually asked for those fields, so an ordinary block
 * returning a fragment is untouched.
 */
function nodeRootReason(
  output: ReactNode,
  node: BlockNode,
  /**
   * Whether the block DECLARED that these props draw nothing.
   *
   * The sound channel, and now the only one that covers a wrapper. It is
   * computed from the node's props — data this renderer already holds — rather
   * than by inspecting a structure the block handed back and still controls.
   * That distinction is the whole point: an inspected structure is re-read by
   * React afterwards, and every accessor, proxy trap and custom iterator in it
   * can answer differently the second time.
   */
  declaresNothing: boolean,
  /**
   * How the output was classified, read ONCE by the caller.
   *
   * Passed in rather than read again here. The warning above asks the same
   * question of the same value, and a second reading is a second chance for an
   * author-controlled accessor to answer differently — which for this policy
   * means throwing on a path with no guard over it, taking the page instead of
   * producing the placeholder this function exists to produce.
   */
  shape: RootShape
): string | null {
  const hasCssId = typeof node.cssId === "string";
  const attributes = node.attributes;
  // Counted by what would actually be WRITTEN, not by what is stored. The
  // render path drops names outside the allowlist and non-string values, so a
  // node whose only attributes are `style` or an `onClick` loses nothing by
  // having no DOM root — refusing it would placeholder a working block over
  // fields that were never going to appear.
  const hasAttributes =
    typeof attributes === "object" &&
    attributes !== null &&
    !Array.isArray(attributes) &&
    Object.entries(attributes).some(
      ([name, value]) => isAllowedAttribute(name) && typeof value === "string"
    );
  if (!hasCssId && !hasAttributes) return null;
  // Rendering NOTHING is a decision, not a failure, and the two must not share
  // an answer. `core/image` with no usable source returns null on purpose —
  // an `<img>` with no `src` re-requests the current page in some browsers —
  // and an author who set an anchor on it has lost the anchor either way. The
  // difference is that a placeholder ALSO reports a working block as broken,
  // and in production that is an invisible marker nobody ever sees.
  //
  // So a block may legitimately render nothing. That is a contract for every
  // block, including ones written outside this package, rather than a special
  // case for the two here that need it today.
  //
  // Every value React draws as nothing counts, not just the nullish pair.
  // `render: () => enabled && <div />` yields `false` when disabled and is the
  // ordinary way to write a conditional block; `""` reaches the same place from
  // a cleared text value. Verified against React 19: `null`, `undefined`,
  // `false`, `true` and `""` all render empty, while `0` renders "0" and is
  // therefore real output with a root.
  // Two ways to be exempt, and neither reads anything the block can change
  // between now and React's own read.
  //
  // The block SAYS so, from its props. Or the output is a value this renderer
  // OWNS: a primitive React draws as nothing, or an array the normalizer
  // materialised, walked by index exactly as React walks it.
  //
  // Deliberately NOT by opening what the block returned. A wrapper's children, a
  // provider's `value`, an element's `key` and `ref`, an iterable's iterator —
  // every one of them is author-controllable, and React reads them AGAIN after
  // this returns. An exemption granted on a reading React need not repeat is one
  // the author can invalidate afterwards, so it is not granted at all. A block
  // that legitimately draws nothing from a wrapper root says so through
  // `rendersNothing`, which is computed from props and cannot vary.
  if (declaresNothing || rendersNothing(output)) return null;
  const noRoot = noHostRootReason(shape);
  if (noRoot === null) return null;
  const named = hasCssId ? "`cssId`" : "attributes";
  // A primitive or a list, on the other hand, is real output with no single
  // element to carry the fields, so it loses them anyway — silently, and with
  // the same broken anchors as a wrapper root. The format says a block renders
  // a single element for these to target.
  return `a node carrying ${named} whose block ${noRoot}, so there is no DOM root to put them on`;
}

/**
 * Why this output gives the node no single host element, or `null` when it does.
 *
 * The SHAPE question alone, separated from what the document asked for, because
 * two readers need it and they must not answer it apart: the placeholder above
 * decides whether root fields can land, and the warning below tells a block
 * author their block does not conform at all. A second copy would let the two
 * disagree about the same output.
 *
 * Asked of what the boundary RECEIVED, never of what a definition predicts.
 * A prediction is a second model of a thing this function already knows
 * first-hand, and the two drift; the artifact is the only witness.
 */
function noHostRootReason(shape: RootShape): string | null {
  switch (shape) {
    case "host":
      return null;
    case "none":
      return "returned no element";
    case "builtin":
    case "component":
      return "returned a wrapper rather than an element";
  }
}

/**
 * What KIND of root a block's output gives the node.
 *
 * The classification itself, held ONCE, because two policies read it and must
 * not classify apart. The placeholder above decides whether root fields can
 * land; the warning below decides whether to tell an author their block is
 * broken. Those are different questions with opposite safe directions — each
 * says which, beside itself — but they are the same READING, and a second copy
 * of the reading is where recognising another wrapper kind updates one answer
 * and leaves the other behind.
 *
 * Asked of what the boundary RECEIVED, never of what a definition predicts. A
 * prediction is a second model of something this already knows first-hand, and
 * the two drift; the artifact is the only witness.
 */
type RootShape = "host" | "component" | "builtin" | "none";

function rootShapeOf(output: ReactNode): RootShape {
  if (!isValidElement(output)) return "none";
  // A string type is a host element, and the only shape that HAS a root.
  if (typeof output.type === "string") return "host";
  /*
   * React's own wrappers — a fragment, a suspense boundary, a context provider
   * or consumer — create no element of their own, so none of them is a root the
   * generated class can be attached to. Whether the block forwarded that class
   * to a child is a separate question, and not one this classification answers.
   *
   * ASKED rather than restated. `renderable.ts` already separates those from
   * `memo`, `forwardRef` and `lazy`, which wrap a component that may well
   * render a host element and forward the class to it; a second reading of the
   * same tags here is where the two would come to disagree.
   */
  if (createsNoHostElement(output.type)) return "builtin";
  /*
   * Everything else is a COMPONENT, which cannot be called broken: it may
   * render a host element and forward `className`, and only calling it would
   * say. That is deliberate under-reporting, and the cheaper error for a
   * diagnostic — a warning that is sometimes false is one people learn to
   * scroll past.
   */
  return "component";
}

/**
 * {@link rootShapeOf} with a floor under it, called ONCE per block root.
 *
 * The classification touches `output.type` and the tag on the type object, both
 * author-controlled, and both readable more than once with different answers: a
 * getter that counts, a proxy that flips. Reproduced against React 19 with a
 * context-tagged type whose `$$typeof` accessor throws on its seventh read —
 * the read the placeholder path made, which had no guard, so the throw left
 * this package entirely and the stream never settled. Not "the page shows an
 * error": nothing resolved at all.
 *
 * So the reading happens here, once, and both policies are handed the result.
 * `unreadable` is a real answer rather than an exception, and the caller turns
 * it into the placeholder every other unusable output already gets — the same
 * direction `isRenderableElementType` takes for a type React would refuse:
 * refusing something valid shows up as a placeholder, accepting something
 * invalid takes the page.
 */
function readRootShape(output: ReactNode): RootShape | "unreadable" {
  try {
    return rootShapeOf(output);
  } catch {
    return "unreadable";
  }
}

/**
 * Why this output is DEFINITELY not the single element the contract asks for,
 * or `null` when it might be.
 *
 * Deliberately NARROWER than {@link noHostRootReason}, and the difference is
 * the point rather than a duplication of it. That one asks whether the renderer
 * may attach root fields, and answers no for a component root because it cannot
 * know the component forwards them — conservative in the direction of refusing,
 * which is right when an anchor is at stake.
 *
 * This one asks whether to tell an author their block is broken, where the safe
 * direction is the opposite. A component that renders one host element and
 * forwards `className` is a legitimate shape whose compiled styles DO apply, so
 * warning about it would be false, and a diagnostic that is sometimes false is
 * one people learn to scroll past. Only shapes with no root element of their
 * own are named: no element, or a wrapper.
 *
 * Naming a shape is not a claim that its styles are lost. A wrapper root can
 * still forward the class to a child, and the warning above says so — what it
 * reports is the shape, which is outside the contract whatever the block did
 * with the class.
 */
function brokenRootReason(shape: RootShape): string | null {
  switch (shape) {
    // A COMPONENT is not broken: one that renders a host element and forwards
    // `className` gets its compiled styles applied. The placeholder still
    // refuses to attach root fields to it, not being able to know that — which
    // is the one place these two policies part company.
    case "host":
    case "component":
      return null;
    case "none":
      return "returned no element";
    case "builtin":
      return "returned a wrapper rather than an element";
  }
}

/**
 * Tells a BLOCK AUTHOR, in development, that their block does not conform.
 *
 * `BlockRenderArgs.className` states the contract every block is handed: "The
 * generated class the block MUST place on its own root element. Blocks render a
 * single element and never wrap it, so styles target that element." A block
 * returning a Fragment, a list or a primitive gives that class no root element
 * to sit on — it is already outside the contract, and nothing said so.
 *
 * NOT "its styles never apply", which is the stronger claim and is false for
 * one real shape: a wrapper whose child takes the class renders it into the
 * DOM, and the compiled CSS then matches normally. What that block loses is the
 * node's ROOT FIELDS, which are attached here and have nowhere to go — so the
 * warning is right and the diagnosis has to be the narrower one.
 *
 * The only signal today arrives through the placeholder above, which fires when
 * a DOCUMENT asks for `cssId` or an attribute. That blames the wrong party at
 * the wrong time: a page author sets an anchor and watches the block vanish,
 * having done nothing wrong, while the block author never hears about it. This
 * fires on the first render instead, whether or not anyone asked for anything.
 *
 * NOT deduplicated by type. A module-scoped set would either couple one test's
 * warning to another's or need a reset API exported for tests to call, and this
 * fires only for a block that is already broken — which in development is one
 * or two instances on screen, not a page full. If that stops being true,
 * deduplicating is a change with its own reset rather than hidden state added
 * to this one.
 *
 * A warning is not an EXEMPTION, which is why reading the output here is safe
 * where granting one from it would not be: nothing about the render changes,
 * so a reading React need not repeat can at worst produce a wrong message.
 */
function warnNoHostRoot(
  output: ReactNode,
  node: BlockNode,
  declaresNothing: boolean,
  /** How the output was classified, read once by the caller. */
  shape: RootShape
): void {
  /*
   * Speaks only where the environment is POSITIVELY identified as one a
   * developer is watching. Read at render rather than module scope, so a
   * consumer's bundler can inline it per build and a test can exercise several
   * environments in one process.
   *
   * Everything else stays silent, which is the opposite of how the placeholder
   * reads the same signal and deliberately so: a placeholder is a visible box
   * on a block that is already broken, while this is an undeduplicated line on
   * every render of every affected block. Unable to tell, a diagnostic says
   * nothing.
   *
   * Being unable to tell has more than one shape, which is what a check for
   * `process === undefined` missed. This renderer runs anywhere React does: an
   * Edge or Worker runtime need not define `process`, a standalone SSR host can
   * expose a partial shim with no `NODE_ENV`, and a deployment may name its
   * environment something this does not recognise. Asking which environments
   * may speak covers all of them at once; asking which must stay quiet is a
   * list, and a list falls behind toward noise in production.
   *
   * The cost is a bare harness that sets no `NODE_ENV` hearing nothing. For an
   * advisory diagnostic that is the cheaper error: a miss costs the report,
   * while a false one in production teaches everyone to filter the message.
   */
  try {
    /*
     * Read INSIDE the guard, because reading it is itself author-exposed. A
     * standalone SSR host supplies its own `process`, and `env` can be a
     * throwing getter or a proxy — so `process.env?.NODE_ENV` raises before a
     * `try` placed after it ever begins. The synchronous call to
     * `checkedOutput` sits PAST the try that contains `render`, as the comment
     * at that call site says, so a raise here does not become a placeholder: it
     * takes the page. An advisory diagnostic aborting the render is the exact
     * thing this function promises not to do.
     *
     * Failing to read it lands in the catch below and says nothing, which is
     * the same answer the checks below give any environment that cannot be
     * positively identified. Unable to tell, a diagnostic stays quiet.
     */
    const environment =
      typeof process === "undefined" ? undefined : process.env?.NODE_ENV;
    if (environment !== "development" && environment !== "test") return;
    // Rendering nothing is a DECISION, not a violation — the same exemption the
    // placeholder grants, asked the same way.
    if (declaresNothing || rendersNothing(output)) return;
    const broken = brokenRootReason(shape);
    if (broken === null) return;
    /*
     * Says what is CERTAIN and nothing more. The class is handed to the block
     * rather than attached here, so a wrapper root that forwards it to a child
     * — `({ className }) => <><div className={className} /></>` — does get its
     * compiled styles, on a page whose DOM carries the class. Telling that
     * author their styles do not apply sends them hunting a failure that is not
     * there, and a diagnostic people find wrong once is one they stop reading.
     *
     * What IS certain either way: the shape is outside the contract, the node
     * has no root element of its own, and its root fields therefore have
     * nowhere to go. The style consequence is stated as the condition it
     * actually is.
     */
    console.warn(
      `[nextly] Block "${node.type}" ${broken}. Blocks render a single element and never wrap it: with no root element of its own, this block's styles apply only where the block itself placed the class, and setting an id or an attribute on the node will replace it with a placeholder.`
    );
  } catch {
    /*
     * A DIAGNOSTIC must never be the thing that fails the page, and this call
     * sits past the try block that contains `render`.
     *
     * It no longer covers the CLASSIFICATION, which was the exposure it was
     * written for: that is read once by {@link readRootShape}, under its own
     * floor, and arrives here as a value. What it covers now is the environment
     * read above, `rendersNothing` over an array this renderer materialised,
     * and the `console` call itself.
     */
  }
}

/**
 * Validates a block's output and substitutes a placeholder when it is unusable.
 *
 * A promise found inside the output gets a boundary here. React 19 renders a
 * promise child by suspending on it, and without one the suspension travels up
 * to whatever boundary sits above the whole page — so a single async child
 * inside an otherwise ordinary block would hold back everything around it.
 */
function checkedOutput(
  value: unknown,
  node: BlockNode,
  fallback: ReactNode,
  // The node's root-level fields belong to the block's OWN root element. This
  // function is re-entered for each awaited child, and applying them again
  // there would put the node's id and attributes on a nested element while the
  // block's root, being a list, received none of them.
  isBlockRoot: boolean,
  /** What the block declared about these props, decided once by the caller. */
  declaresNothing: boolean,
  /** Whether the block's definition declares at least one slot, decided once by the caller. */
  declaresSlots: boolean,
  /** Whether the editor asked for a per-node DOM address. */
  nodeAttribute = false
): ReactNode {
  const result = normalizeRenderable(value, {
    // A promise the block returned inside a list is awaited under the same
    // containment its own render gets, so a rejection becomes this block's
    // placeholder instead of an error React raises after the boundary has
    // already returned. Each gets its own boundary, so one slow child does not
    // hold back the siblings beside it.
    wrapOwnedThenable: (pending, index) => (
      <Suspense key={`nx-async-${index}`} fallback={fallback}>
        <AsyncBlockOutput
          pending={pending}
          node={node}
          fallback={fallback}
          isBlockRoot={false}
          declaresNothing={declaresNothing}
          declaresSlots={declaresSlots}
          nodeAttribute={nodeAttribute}
        />
      </Suspense>
    ),
  });

  if (!result.ok) {
    return (
      <BlockPlaceholder
        reason="invalid-output"
        type={node.type}
        id={node.id}
        detail={`Expected a React node, received ${result.reason}`}
      />
    );
  }

  // Warned INDEPENDENTLY of whether the document asked for root fields: the
  // block is non-conforming either way, and waiting for someone to set an
  // anchor is what made a page author look responsible for it.
  /*
   * Classified ONCE, and both policies below read that value rather than the
   * output. They ask the same question of the same author-controlled object,
   * and asking twice is asking something that can answer differently — which
   * for the placeholder path meant an accessor throwing where nothing guarded
   * it. One reading, two policies.
   */
  const shape = isBlockRoot ? readRootShape(result.node) : null;
  if (shape === "unreadable") {
    /*
     * Refused rather than passed on. React reads the same accessors after this
     * returns, so output that cannot be classified here is output whose next
     * read is React's, past this boundary and past any containment — which is
     * exactly the failure `normalizeRenderable` exists to prevent.
     */
    return (
      <BlockPlaceholder
        reason="invalid-output"
        type={node.type}
        id={node.id}
        detail="Expected a React node, received output whose own element type could not be read"
      />
    );
  }
  if (shape !== null) warnNoHostRoot(result.node, node, declaresNothing, shape);
  const rootReason =
    shape !== null
      ? nodeRootReason(result.node, node, declaresNothing, shape)
      : null;
  if (rootReason !== null) {
    return (
      <BlockPlaceholder
        reason="invalid-output"
        type={node.type}
        id={node.id}
        detail={rootReason}
      />
    );
  }

  // Only promises inside borrowed JSX children reach here unwrapped, since
  // nothing can be substituted into an element that already exists. React
  // suspends on them, so they still need a boundary above.
  const withAttributes = isBlockRoot
    ? withNodeAttributes(result.node, node, nodeAttribute, declaresSlots)
    : result.node;
  if (!result.hasUnwrappedThenable) return withAttributes;
  return <Suspense fallback={fallback}>{withAttributes}</Suspense>;
}

/**
 * Awaits an async block's output with the same containment the sync path has.
 *
 * Split into its own async component rather than making the boundary itself
 * async, because that choice decides whether a static page stays static. An
 * async component suspends, and a boundary that awaited unconditionally would
 * suspend on every block — turning a page of forty ordinary sections into forty
 * streaming chunks, each arriving after its own fallback. Only blocks that are
 * actually asynchronous pay for being asynchronous.
 */
async function AsyncBlockOutput({
  pending,
  node,
  fallback,
  isBlockRoot,
  declaresNothing,
  declaresSlots,
  nodeAttribute,
}: {
  pending: PromiseLike<unknown>;
  node: BlockNode;
  fallback: ReactNode;
  isBlockRoot: boolean;
  /** Carried from the caller, which asked the definition once before rendering. */
  declaresNothing: boolean;
  /** Carried from the caller, which asked the definition once before rendering. */
  declaresSlots: boolean;
  /** Whether the editor asked for a per-node DOM address. */
  nodeAttribute?: boolean;
}): Promise<ReactNode> {
  try {
    return checkedOutput(
      await pending,
      node,
      fallback,
      isBlockRoot,
      declaresNothing,
      declaresSlots,
      nodeAttribute
    );
  } catch (error) {
    return (
      <BlockPlaceholder
        reason="render-error"
        type={node.type}
        id={node.id}
        detail={describeThrown(error)}
      />
    );
  }
}

/**
 * Renders one node, and contains everything that node can do wrong.
 *
 * **Why containment is server-side.** In the App Router a Server Component's
 * error never reaches a client error boundary: the error is caught while the
 * RSC payload is generated, replaced with a digest, and the payload tells the
 * client to render the route segment's own `error.tsx`. A `"use client"`
 * boundary wrapped around a server-rendered block would never see it, so the
 * familiar React answer does not work here — one throwing block would replace
 * the whole route with its error page.
 *
 * Catching where the block is actually called is therefore not an optimisation
 * but the only mechanism available, and it happens to be the better one: it
 * needs no client component, so a page of server blocks still ships no
 * JavaScript.
 *
 * **What is contained:** a synchronous throw, a rejected async render, and
 * output React cannot render. **What is not:** a throw from inside a component
 * the block itself returned and React renders later, which is past the point
 * this function can observe. Awaiting the block's own work covers the ordinary
 * shape of a data-driven block; a block that defers work into a nested async
 * component needs the route's `error.tsx`.
 */
export function BlockBoundary({
  node,
  context,
  blocks,
  classes,
  fallback,
  hostPolicy,
  nodeAttribute,
}: BlockBoundaryProps): ReactNode {
  // A node the migration pass could not bring to its block's current version
  // keeps its last-good props, which the current render would misread. The
  // placeholder is the honest answer and it comes before resolution, since a
  // stale node is stale whether or not its type is still registered.
  // `=== true`, not truthy. A stored `"false"` or `{}` is truthy and would drop
  // public content that never failed anything; the repair pass normalises
  // structure but leaves this control flag as written.
  // Asked before the definition lookup, because the reserved instance type has
  // no registered block: falling through would draw "no block is registered
  // for this type", which is true, tells an author nothing, and hides the one
  // fact they can act on — that a component they placed did not load.
  if (node.unresolvedComponent !== undefined) {
    return (
      <BlockPlaceholder
        reason="unresolved-component"
        type={node.type}
        id={node.id}
        detail={UNRESOLVED_DETAIL[node.unresolvedComponent]}
      />
    );
  }

  if (node.migrationFailed === true) {
    return (
      <BlockPlaceholder
        reason="migration-failed"
        type={node.type}
        id={node.id}
      />
    );
  }

  const definition = blocks.get(node.type);
  if (!definition) {
    return (
      <BlockPlaceholder reason="unknown-block" type={node.type} id={node.id} />
    );
  }

  // A node saved against a NEWER definition than this app has. The migration
  // pass only ever upgrades, so it leaves such a node untouched and the older
  // renderer would then read props shaped for a schema it has never seen. That
  // is a wrong page rather than a missing block, and it is the same situation a
  // failed upgrade produces from the other direction.
  if (node.version > definition.version) {
    return (
      <BlockPlaceholder
        reason="version-ahead"
        type={node.type}
        id={node.id}
        detail={`Stored at version ${node.version}, but this app has version ${definition.version}`}
      />
    );
  }

  const className = classNameFor(node, classes);

  // Asked BEFORE the block renders, of the STORED props, which is what the
  // contract in `blocks-engine` says this answer is about. Asking afterwards
  // reads whatever the render left behind: a block that mutates its own props
  // while building its output would be judged on the mutated object and could
  // declare itself empty while holding elements.
  //
  // Contained, because it is plugin code running outside the render's own
  // try/catch. A declaration that throws is no declaration rather than the
  // page's error. A non-boolean answer is likewise no declaration — and a
  // THENABLE one gets a handler attached, because a rejection nobody is
  // listening for takes down the process under Node's default
  // `--unhandled-rejections=throw`.
  let declaresNothing = false;
  try {
    const declared: unknown = definition.rendersNothing?.(node.props);
    declaresNothing = declared === true;
    if (isThenable(declared))
      void Promise.resolve(declared).catch(() => undefined);
  } catch {
    declaresNothing = false;
  }

  // Contained for the same reason `declaresNothing` above is: `slots` is a
  // property on an object a plugin author wrote, so a getter or a proxy can
  // throw. A declaration that throws is no declaration, never the page's error.
  let declaresSlots = false;
  try {
    const slots: unknown = definition.slots;
    declaresSlots =
      typeof slots === "object" &&
      slots !== null &&
      Object.keys(slots).length > 0;
  } catch {
    declaresSlots = false;
  }

  const marker = propMarker(definition, nodeAttribute === true);

  let output: unknown;
  try {
    output = definition.render({
      props: node.props,
      node,
      className,
      // Built from the DEFINITION being rendered, so a block cannot name a
      // neighbour's type and quietly wear its defaults. An undeclared name
      // returns "" rather than a class, so a typo leaves the element unstyled
      // instead of marked with a class no rule targets.
      partClass: (name: string) =>
        definition.parts !== undefined && Object.hasOwn(definition.parts, name)
          ? blockPartClassName(definition.name, name)
          : "",
      ctx: context,
      // Undefined rather than a no-op function when this is not an editor
      // render, so `markProp?.("text")` spreads nothing and a published page
      // is byte-identical to one rendered before this existed.
      ...(marker === undefined ? {} : { markProp: marker }),
      // The renderer's, not the context's. A block may replace the context its
      // slot children see; it can neither drop nor forge this.
      ...(hostPolicy === undefined ? {} : { hostPolicy }),
      // Synchronous by contract: it returns an element describing what to
      // render, not the rendered result. That is what lets a block call it
      // inside its own JSX, and what lets a slot that is never shown never run
      // the work inside it — creating the element costs nothing, and React only
      // renders it if the block puts it somewhere.
      renderSlot: (name: string, slotContext?: PageContext) => (
        <BlockList
          nodes={slotNodes(node, name)}
          // A block may replace the context its slot children see — that is how
          // a repeater sets `item` per iteration — and the policy travels
          // beside it either way, so a nested block cannot lose the grant by
          // being nested nor gain one by rebuilding the context.
          context={slotContext ?? context}
          blocks={blocks}
          classes={classes}
          fallback={fallback}
          {...(hostPolicy === undefined ? {} : { hostPolicy })}
          {...(nodeAttribute === undefined ? {} : { nodeAttribute })}
        />
      ),
    });
  } catch (error) {
    return (
      <BlockPlaceholder
        reason="render-error"
        type={node.type}
        id={node.id}
        detail={describeThrown(error)}
      />
    );
  }

  // `isThenable` is total, so a value whose `then` getter throws is reported as
  // not-a-promise and falls into the checked path, where it becomes this
  // block's placeholder. A predicate that could raise would do so out here,
  // past the try block above, and take the page with it.
  if (!isThenable(output)) {
    return checkedOutput(
      output,
      node,
      fallback,
      true,
      declaresNothing,
      declaresSlots,
      nodeAttribute
    );
  }

  return (
    <Suspense fallback={fallback}>
      <AsyncBlockOutput
        pending={output}
        node={node}
        fallback={fallback}
        isBlockRoot
        declaresNothing={declaresNothing}
        declaresSlots={declaresSlots}
        nodeAttribute={nodeAttribute}
      />
    </Suspense>
  );
}

export interface BlockListProps {
  nodes: readonly BlockNode[];
  context: PageContext;
  blocks: BlockResolver;
  classes: Record<string, string>;
  fallback?: ReactNode;
  hostPolicy?: BlockHostPolicy;
  /**
   * Emit `data-nx-node="<node id>"` on each block's root element.
   *
   * OFF by default: a published page should not carry editor concerns, which is
   * the same reason Gutenberg emits its `data-block` in the editor and not in
   * post content. An editor turns it on and gets a stable address per node.
   *
   * It is the ONLY per-node hook that reaches the DOM independently of styling.
   * The scoped class does not: `classNameFor` returns the block-TYPE class alone
   * for a node with no compiled styles, so hit-testing on the class cannot
   * address an unstyled node and would resolve to the wrong one.
   */
  nodeAttribute?: boolean;
}

/**
 * A list of sibling nodes, each contained on its own.
 *
 * Keyed by node id, which the document format guarantees is stable across
 * moves and unique within a document. Keying by index would make React reuse
 * one block's state for another after a reorder.
 */
export function BlockList({
  nodes,
  context,
  blocks,
  classes,
  fallback,
  hostPolicy,
  nodeAttribute,
}: BlockListProps): ReactNode {
  return nodes
    .filter(isUnconditional)
    .map(node => (
      <BlockBoundary
        key={node.id}
        node={node}
        context={context}
        blocks={blocks}
        classes={classes}
        fallback={fallback}
        {...(hostPolicy === undefined ? {} : { hostPolicy })}
        {...(nodeAttribute === undefined ? {} : { nodeAttribute })}
      />
    ));
}
