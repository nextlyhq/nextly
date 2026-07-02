/**
 * Recursively renders one block node to React (spec §10). Server-safe: no browser
 * globals, no `getNextly`. The scoped class is applied to the block's OWN root element
 * (the block spreads `className`) so there is no mandatory wrapper `<div>` — grid/flex
 * stay correct. Unknown block types render a safe fallback; each node is isolated by an
 * error boundary so one broken block never takes down the page.
 */
import type { ReactNode } from "react";

import type { BlockRegistry } from "../core/registry";
import { nodeClass } from "../core/style-compiler";
import type { BlockNode } from "../core/types";

import type { DataProvider } from "./dataProvider";
import { BlockErrorBoundary } from "./ErrorBoundary";

export interface RenderNodeProps {
  node: BlockNode;
  registry: BlockRegistry;
  dataProvider?: DataProvider;
}

export function RenderNode({
  node,
  registry,
  dataProvider,
}: RenderNodeProps): ReactNode {
  const def = registry.get(node.type);
  const className = [nodeClass(node.id), node.customClass]
    .filter(Boolean)
    .join(" ");

  if (!def) {
    // Preserve, don't crash: a placeholder that keeps the page rendering.
    return <div data-nx-unknown={node.type} className={className} />;
  }

  const slots: Record<string, ReactNode> = {};
  if (node.slots) {
    for (const [name, children] of Object.entries(node.slots)) {
      slots[name] = children.map(child => (
        <RenderNode
          key={child.id}
          node={child}
          registry={registry}
          dataProvider={dataProvider}
        />
      ));
    }
  }

  return (
    <BlockErrorBoundary>
      {def.render({ props: node.props, node, slots, className })}
    </BlockErrorBoundary>
  );
}
