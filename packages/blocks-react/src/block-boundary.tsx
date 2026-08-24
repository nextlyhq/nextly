import { blockTypeClassName, type BlockNode } from "@nextlyhq/blocks-engine";
import { Suspense, cloneElement, isValidElement, type ReactNode } from "react";

import type { BlockHostPolicy, PageContext } from "./context";
import { BlockPlaceholder } from "./placeholder";
import { describeThrown, isThenable, normalizeRenderable } from "./renderable";
import type { BlockResolver } from "./resolver";
import { isUnconditional } from "./visibility";

/** What a render needs to turn one node into output. */
export interface BlockBoundaryProps {
  node: BlockNode;
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

function withNodeAttributes(
  output: ReactNode,
  node: BlockNode,
  nodeAttribute = false
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
      extra[key] = value;
    }
  }
  // The modelled field wins over an attribute of the same name: `cssId` is what
  // the editor writes, and the attribute bag is the escape hatch beside it.
  if (cssId !== undefined) extra.id = cssId;
  /*
   * LAST, so it cannot be overwritten. This was written first, with a comment
   * saying that made it safe — the opposite of what the code did: the author's
   * loop ran afterwards and assigning the same key simply replaced it. A
   * document could therefore hand every block the same address, or one block
   * another's, and the editor's hit-testing reads exactly this value to decide
   * which block was clicked.
   *
   * It is the editor's address for a node, not a value the document may set, so
   * the position enforces that rather than a note asking the loop above to.
   */
  if (nodeAttribute) extra[NODE_ID_ATTRIBUTE] = node.id;

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
  declaresNothing: boolean
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
  const named = hasCssId ? "`cssId`" : "attributes";
  // A primitive or a list, on the other hand, is real output with no single
  // element to carry the fields, so it loses them anyway — silently, and with
  // the same broken anchors as a wrapper root. The format says a block renders
  // a single element for these to target.
  if (!isValidElement(output)) {
    return `a node carrying ${named} whose block returned no element, so there is no DOM root to put them on`;
  }
  if (typeof output.type === "string") return null;
  return `a node carrying ${named} whose block returned a wrapper rather than an element, so there is no DOM root to put them on`;
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

  const rootReason = isBlockRoot
    ? nodeRootReason(result.node, node, declaresNothing)
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
    ? withNodeAttributes(result.node, node, nodeAttribute)
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
  nodeAttribute,
}: {
  pending: PromiseLike<unknown>;
  node: BlockNode;
  fallback: ReactNode;
  isBlockRoot: boolean;
  /** Carried from the caller, which asked the definition once before rendering. */
  declaresNothing: boolean;
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

  const marker = propMarker(definition, nodeAttribute === true);

  let output: unknown;
  try {
    output = definition.render({
      props: node.props,
      node,
      className,
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
