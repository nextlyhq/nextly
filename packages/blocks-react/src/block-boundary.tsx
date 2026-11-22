import {
  blockPartClassName,
  blockTypeClassName,
  renderedCssClassNames,
  type BlockNode,
  type ComponentUnresolvedReason,
  type ResolvedBlockNode,
} from "@nextlyhq/blocks-engine";
import { Fragment, type ReactNode } from "react";

import {
  propMarker,
  editorIdentityOf,
  placeholderEditor,
} from "./block-boundary-attributes";
import {
  type BoundaryBindings,
  type BoundaryConditions,
  drawnNodes,
  itemRulesFor,
  withItemBindings,
  boundArgument,
} from "./block-boundary-bindings";
import {
  asyncWaitingOf,
  checkedOutput,
  editorOutputSlot,
  AsyncBlockOutput,
  waitingAs,
} from "./block-boundary-output";
import type { BlockHostPolicy, PageContext } from "./context";
import { BlockPlaceholder } from "./placeholder";
// The SAME predicate the pipeline uses. Asking the question twice is how the
// renderer came to hide a node the exported reader returns: the pipeline kept
// a block carrying a stored `unresolvedComponent` key and this boundary drew a
// placeholder over it, so one document had two readings.
import { isUnresolvedInstance } from "./prepare-document";
import { describeThrown, isThenable } from "./renderable";
import type { BlockResolver } from "./resolver";

export type {
  BoundaryBindings,
  BoundaryConditions,
  ItemHiddenAs,
  HidingItem,
} from "./block-boundary-bindings";
export { isAllowedAttribute } from "./block-boundary-attributes";

/**
 * The wording for one reason, or nothing when the marker names none.
 *
 * Asked of a `Map`, and that is the whole point of the indirection. The
 * predicate that admits a node here reads the reserved instance TYPE, and the
 * reason beside it is stored content nothing strips — so an unrecognised
 * string arrives, and `constructor` or `__proto__` indexed on a record answer
 * with an inherited member rather than with nothing. React refuses an object
 * for a child, so the page dies inside the one component that exists to
 * contain a failure. A `Map` holds only what was put in it.
 */
function unresolvedDetail(
  reason: ComponentUnresolvedReason | undefined
): string | undefined {
  return reason === undefined ? undefined : DETAIL_BY_REASON.get(reason);
}

/**
 * What an author is told when a component did not load.
 *
 * Wording per cause, because the remedies are different things and a single
 * message would send an author looking in the wrong place for most of them.
 * Development only: the production placeholder renders nothing.
 *
 * A record rather than the `Map` it becomes, so the compiler still requires a
 * wording for every reason the engine publishes — a `Map` literal would accept
 * one that named five of them and go quiet about the sixth.
 */
const UNRESOLVED_DETAIL: Readonly<Record<ComponentUnresolvedReason, string>> = {
  missing: "No published component was found for this reference",
  cycle: "This component contains itself",
  "composed-depth": "This component is nested inside too many components",
  "node-depth": "This component's own content is nested too deeply",
  budget: "This page is already at its node limit",
  malformed: "This instance names no component",
  unreadable: "This component's stored data cannot be read",
};

/** Derived, so the two cannot name different sets of reasons. */
const DETAIL_BY_REASON: ReadonlyMap<string, string> = new Map(
  Object.entries(UNRESOLVED_DETAIL)
);

/**
 * Whether a definition declares any slot.
 *
 * Contained for the same reason the `rendersNothing` declaration is: `slots`
 * is a property on an object a plugin author wrote, so a getter or a proxy can
 * throw. A declaration that throws is no declaration, never the page's error.
 */
function declaresAnySlot(definition: { readonly slots?: unknown }): boolean {
  try {
    const slots: unknown = definition.slots;
    return (
      typeof slots === "object" &&
      slots !== null &&
      Object.keys(slots).length > 0
    );
  } catch {
    return false;
  }
}

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
  /**
   * Shown while an async block is still producing output. Given, each async
   * block waits in a boundary of its own and streams; absent, outside an
   * editor surface, it waits in place so the page's HTML holds it (see
   * `AsyncWaiting`).
   */
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
  /**
   * Keep each async block's output between draws, as `nodeAttribute` does,
   * for an editor surface that addresses no node (see
   * `PageRendererProps.keepAsyncOutputs`). Never on a published page.
   */
  keepAsyncOutputs?: boolean;
  /** The page's bindings, when the page has any to fill. */
  bindings?: BoundaryBindings;
  /** What the render decided about its conditioned blocks. */
  conditions?: BoundaryConditions;
}

/**
 * The classes a block puts on its own root element.
 *
 * Two, not one. The node's own class carries what was set on this instance; the
 * block-type class carries the shared defaults the compiler emits once per type
 * rather than copying into every node. A block given only its node class loses
 * every default its type defines.
 *
 * Then the author's own names (`cssClasses`), after every generated class, so
 * a site's stylesheet can target the block. Carried in the class the block is
 * handed rather than attached to its root afterwards, so every block, a
 * plugin's included, wears them on the element it already puts its class on.
 * Only the names a save accepts are drawn; a node without any draws exactly
 * the two classes it did before.
 */
function classNameFor(
  node: BlockNode,
  classes: Record<string, string>
): string {
  const nodeClass = classes[node.id];
  const typeClass = blockTypeClassName(node.type);
  const generated = nodeClass ? `${nodeClass} ${typeClass}` : typeClass;
  const own = renderedCssClassNames(node.cssClasses);
  return own.length === 0 ? generated : `${generated} ${own.join(" ")}`;
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

// Re-exported: this module PUBLISHES the names, which consumers outside the
// package address elements by. The modules that draw the marks import them
// from `editor-markers`.
export {
  EDITOR_NAMESPACE,
  ENTRY_CONTENT_DRAWN_ATTRIBUTE,
  ENTRY_CONTENT_NOTE_ATTRIBUTE,
  INSTANCE_ATTRIBUTE,
  LIST_ACTION_ATTRIBUTE,
  LIST_REF_ATTRIBUTE,
  NODE_ID_ATTRIBUTE,
  PROP_ATTRIBUTE,
  SLOTS_ATTRIBUTE,
} from "./editor-markers";

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
  node: stored,
  context,
  blocks,
  classes,
  fallback,
  hostPolicy,
  nodeAttribute,
  keepAsyncOutputs,
  bindings,
  conditions,
}: BlockBoundaryProps): ReactNode {
  /*
   * FIRST, before anything on this path can run author code.
   *
   * The obvious place is beside the render call, and it is too late by three
   * guards: `definition.rendersNothing`, the `definition.slots` read and the
   * render itself are all plugin code, and each is handed — or can reach — the
   * same mutable `node`. A getter on `slots` is enough. Taking the reading
   * here makes the window empty rather than small, which is the only size that
   * does not need arguing about again the next time a guard moves.
   */
  const identity = editorIdentityOf(stored, nodeAttribute);

  // A list item's bindings, filled before anything below reads the props, so
  // the block, its `rendersNothing` and its slots all see the filled values.
  // Nothing on this path throws: the pass is total.
  const { node, bound } = withItemBindings(stored, context, bindings);

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
  if (isUnresolvedInstance(node)) {
    return (
      <BlockPlaceholder
        reason="unresolved-component"
        type={node.type}
        id={node.id}
        editor={placeholderEditor(nodeAttribute, identity)}
        detail={unresolvedDetail(node.unresolvedComponent)}
      />
    );
  }

  if (node.migrationFailed === true) {
    return (
      <BlockPlaceholder
        reason="migration-failed"
        type={node.type}
        id={node.id}
        editor={placeholderEditor(nodeAttribute, identity)}
      />
    );
  }

  const definition = blocks.get(node.type);
  if (!definition) {
    return (
      <BlockPlaceholder
        reason="unknown-block"
        type={node.type}
        id={node.id}
        editor={placeholderEditor(nodeAttribute, identity)}
      />
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
        editor={placeholderEditor(nodeAttribute, identity)}
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

  const declaresSlots = declaresAnySlot(definition);

  const marker = propMarker(definition, nodeAttribute === true);

  // An editor surface: one drawn with node addresses, or keeping its async
  // outputs between draws. It reuses the output it already has for this
  // block as it stands (see `EDITOR_OUTPUTS`), and an async block on it waits
  // in a boundary of its own (see `AsyncWaiting`).
  const editorSurface = nodeAttribute === true || keepAsyncOutputs === true;
  const waiting = asyncWaitingOf(fallback, editorSurface);
  const editorSlot = editorOutputSlot(
    editorSurface,
    nodeAttribute === true,
    hostPolicy,
    context,
    definition.name,
    className,
    node,
    bound
  );

  let output: unknown;
  try {
    // The output already kept for this block as it stands, or a new one.
    output = editorSlot.output(() =>
      definition.render({
        props: node.props,
        node,
        className,
        // Built from the DEFINITION being rendered, so a block cannot name a
        // neighbour's type and quietly wear its defaults. An undeclared name
        // returns "" rather than a class, so a typo leaves the element unstyled
        // instead of marked with a class no rule targets.
        partClass: (name: string) =>
          definition.parts !== undefined &&
          Object.hasOwn(definition.parts, name)
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
        // The renderer's too, for the same reason: what a bound prop holds comes
        // from the pass that filled it, never from a context a block built.
        ...boundArgument(bound),
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
            {...(keepAsyncOutputs === true ? { keepAsyncOutputs } : {})}
            bindings={bindings}
            {...(conditions === undefined ? {} : { conditions })}
          />
        ),
      })
    );
  } catch (error) {
    return (
      <BlockPlaceholder
        reason="render-error"
        type={node.type}
        id={node.id}
        editor={placeholderEditor(nodeAttribute, identity)}
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
      waiting,
      true,
      declaresNothing,
      declaresSlots,
      nodeAttribute,
      identity
    );
  }

  editorSlot.keep(output);

  return waitingAs(
    waiting,
    <AsyncBlockOutput
      pending={output}
      node={node}
      waiting={waiting}
      isBlockRoot
      declaresNothing={declaresNothing}
      declaresSlots={declaresSlots}
      nodeAttribute={nodeAttribute}
      identity={identity}
    />
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
  /**
   * Keep each async block's output between draws, as `nodeAttribute` does,
   * for an editor surface that addresses no node (see
   * `PageRendererProps.keepAsyncOutputs`). Never on a published page.
   */
  keepAsyncOutputs?: boolean;
  /** The page's bindings, when the page has any to fill. */
  bindings?: BoundaryBindings;
  /** What the render decided about its conditioned blocks. */
  conditions?: BoundaryConditions;
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
  keepAsyncOutputs,
  bindings,
  conditions,
}: BlockListProps): ReactNode {
  // A conditioned block is drawn where its conditions allow it: held for the
  // page's entry, or holding for the list item being drawn.
  return drawnNodes(nodes, context, conditions).map(({ node, shown }) => (
    <Fragment key={node.id}>
      {shown ? itemRulesFor(node.id, conditions) : null}
      <BlockBoundary
        node={node}
        context={context}
        blocks={blocks}
        classes={classes}
        fallback={fallback}
        {...(hostPolicy === undefined ? {} : { hostPolicy })}
        {...(nodeAttribute === undefined ? {} : { nodeAttribute })}
        {...(keepAsyncOutputs === true ? { keepAsyncOutputs } : {})}
        {...(bindings === undefined ? {} : { bindings })}
        {...(conditions === undefined ? {} : { conditions })}
      />
    </Fragment>
  ));
}
