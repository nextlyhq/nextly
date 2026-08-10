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
 * Whether an author-supplied attribute may reach the DOM.
 *
 * `data-*` and `aria-*` are open by prefix: both are namespaces defined to carry
 * author data and accessibility semantics, neither can name a destination or
 * execute anything, and closing them would defeat the feature the field exists
 * for. `role` is the ARIA sibling of `aria-*` and belongs with them.
 */
function isAllowedAttribute(name: string): boolean {
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
function withNodeAttributes(output: ReactNode, node: BlockNode): ReactNode {
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
  if (cssId === undefined && !hasAttributes) return output;
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

  return Object.keys(extra).length > 0 ? cloneElement(output, extra) : output;
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
function nodeRootReason(output: ReactNode, node: BlockNode): string | null {
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
  const named = hasCssId ? "`cssId`" : "attributes";
  // A primitive or a list has no root at all, which loses the fields exactly as
  // a wrapper root does — silently, and with the same broken anchors. The
  // format says a block renders a single element for these to target.
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
  isBlockRoot: boolean
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

  const rootReason = isBlockRoot ? nodeRootReason(result.node, node) : null;
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
    ? withNodeAttributes(result.node, node)
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
}: {
  pending: PromiseLike<unknown>;
  node: BlockNode;
  fallback: ReactNode;
  isBlockRoot: boolean;
}): Promise<ReactNode> {
  try {
    return checkedOutput(await pending, node, fallback, isBlockRoot);
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

  let output: unknown;
  try {
    output = definition.render({
      props: node.props,
      node,
      className,
      ctx: context,
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
  if (!isThenable(output)) return checkedOutput(output, node, fallback, true);

  return (
    <Suspense fallback={fallback}>
      <AsyncBlockOutput
        pending={output}
        node={node}
        fallback={fallback}
        isBlockRoot
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
      />
    ));
}
