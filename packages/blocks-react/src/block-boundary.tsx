import { blockTypeClassName, type BlockNode } from "@nextlyhq/blocks-engine";
import { Suspense, type ReactNode } from "react";

import type { PageContext } from "./context";
import { BlockPlaceholder } from "./placeholder";
import { describeValue, isRenderableNode, isThenable } from "./renderable";
import type { BlockResolver } from "./resolver";

/** What a render needs to turn one node into output. */
export interface BlockBoundaryProps {
  node: BlockNode;
  context: PageContext;
  blocks: BlockResolver;
  /** Node id to generated class, from the compiled stylesheet. */
  classes: Record<string, string>;
  /** Shown while an async block is still producing output. */
  fallback?: ReactNode;
}

/** The message to show for a thrown value, which need not be an `Error`. */
function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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

/** Validates a block's output and substitutes a placeholder when it is unusable. */
function checkedOutput(value: unknown, node: BlockNode): ReactNode {
  if (isRenderableNode(value)) return value;
  return (
    <BlockPlaceholder
      reason="invalid-output"
      type={node.type}
      id={node.id}
      detail={`Expected a React node, received ${describeValue(value)}`}
    />
  );
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
}: {
  pending: PromiseLike<unknown>;
  node: BlockNode;
}): Promise<ReactNode> {
  try {
    return checkedOutput(await pending, node);
  } catch (error) {
    return (
      <BlockPlaceholder
        reason="render-error"
        type={node.type}
        id={node.id}
        detail={errorDetail(error)}
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
}: BlockBoundaryProps): ReactNode {
  // A node the migration pass could not bring to its block's current version
  // keeps its last-good props, which the current render would misread. The
  // placeholder is the honest answer and it comes before resolution, since a
  // stale node is stale whether or not its type is still registered.
  if (node.migrationFailed) {
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

  const className = classNameFor(node, classes);

  let output: unknown;
  try {
    output = definition.render({
      props: node.props,
      node,
      className,
      ctx: context,
      // Synchronous by contract: it returns an element describing what to
      // render, not the rendered result. That is what lets a block call it
      // inside its own JSX, and what lets a slot that is never shown never run
      // the work inside it — creating the element costs nothing, and React only
      // renders it if the block puts it somewhere.
      renderSlot: (name: string, slotContext?: PageContext) => (
        <BlockList
          nodes={node.slots?.[name] ?? []}
          context={slotContext ?? context}
          blocks={blocks}
          classes={classes}
          fallback={fallback}
        />
      ),
    });
  } catch (error) {
    return (
      <BlockPlaceholder
        reason="render-error"
        type={node.type}
        id={node.id}
        detail={errorDetail(error)}
      />
    );
  }

  if (!isThenable(output)) return checkedOutput(output, node);

  return (
    <Suspense fallback={fallback}>
      <AsyncBlockOutput pending={output} node={node} />
    </Suspense>
  );
}

export interface BlockListProps {
  nodes: readonly BlockNode[];
  context: PageContext;
  blocks: BlockResolver;
  classes: Record<string, string>;
  fallback?: ReactNode;
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
}: BlockListProps): ReactNode {
  return nodes.map(node => (
    <BlockBoundary
      key={node.id}
      node={node}
      context={context}
      blocks={blocks}
      classes={classes}
      fallback={fallback}
    />
  ));
}
