/**
 * Recursively renders one block node to React (spec §10). Server-safe: no browser
 * globals, no `getNextly`. The scoped class is applied to the block's OWN root element
 * (the block spreads `className`) so there is no mandatory wrapper `<div>` — grid/flex
 * stay correct. Unknown block types render a safe fallback; each node is isolated by an
 * error boundary so one broken block never takes down the page.
 *
 * Query Loop (spec §10): the current loop `item` is threaded through recursion (NOT React
 * context — Server Components can't consume context), so a bound prop on any nested block
 * at any depth resolves via `resolveBindings`. `core/query-loop` is intercepted and
 * rendered data-driven via `QueryLoop`.
 */
import { cloneElement, isValidElement, type ReactNode } from "react";

import { resolveBindings } from "../core/bindings";
import type { BlockRegistry } from "../core/registry";
import { nodeClass } from "../core/style-compiler";
import type { BlockNode } from "../core/types";

import type { DataProvider } from "./dataProvider";
import { BlockErrorBoundary } from "./ErrorBoundary";
import { QueryLoop } from "./query/QueryLoop";
import type { QueryBudget } from "./query/runQuery";
import { QUERY_LOOP_TYPE } from "./query/types";

const BLOCKED_ATTRS = new Set(["style", "srcdoc", "class", "classname"]);

/** Allowlist author-supplied HTML attributes: valid names, no event handlers, no style. */
function safeAttributes(
  attrs?: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!attrs) return out;
  for (const [k, v] of Object.entries(attrs)) {
    const key = k.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(key)) continue; // valid attr name only
    if (key.startsWith("on")) continue; // no event handlers
    if (BLOCKED_ATTRS.has(key)) continue;
    out[k] = String(v);
  }
  return out;
}

export interface RenderNodeProps {
  node: BlockNode;
  registry: BlockRegistry;
  dataProvider?: DataProvider;
  /** Current Query Loop item — threaded to resolve bindings at any depth. */
  item?: Record<string, unknown>;
  /** Remaining query budget shared across nested loops on this page render. */
  budget?: QueryBudget;
  /** Reusable-block library: refId → stored subtree (spec §H). */
  refs?: Record<string, BlockNode>;
  /** Visited ref ids on the current path — guards against reference cycles. */
  refStack?: string[];
}

const REF_TYPE = "core/ref";

export function RenderNode({
  node,
  registry,
  dataProvider,
  item,
  budget,
  refs,
  refStack,
}: RenderNodeProps): ReactNode {
  const className = [nodeClass(node.id), node.customClass]
    .filter(Boolean)
    .join(" ");

  // Reusable block: resolve the referenced subtree (cycle-guarded).
  if (node.type === REF_TYPE) {
    const refId = typeof node.props.refId === "string" ? node.props.refId : "";
    const target = refId ? refs?.[refId] : undefined;
    if (!target || (refStack ?? []).includes(refId)) {
      return <div data-nx-ref-missing={refId || "?"} className={className} />;
    }
    return (
      <RenderNode
        node={target}
        registry={registry}
        dataProvider={dataProvider}
        item={item}
        budget={budget}
        refs={refs}
        refStack={[...(refStack ?? []), refId]}
      />
    );
  }

  const def = registry.get(node.type);

  if (!def) {
    // Preserve, don't crash: a placeholder that keeps the page rendering.
    return <div data-nx-unknown={node.type} className={className} />;
  }

  // Executable Query Loop: intercept and render data-driven (spec §10).
  if (node.type === QUERY_LOOP_TYPE) {
    return (
      <BlockErrorBoundary>
        <QueryLoop
          node={node}
          registry={registry}
          dataProvider={dataProvider}
          className={className}
          budget={budget ?? { n: 0 }}
        />
      </BlockErrorBoundary>
    );
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
          item={item}
          budget={budget}
          refs={refs}
          refStack={refStack}
        />
      ));
    }
  }

  const props = item ? resolveBindings(node, item) : node.props;
  const el = def.render({ props, node, slots, className });

  const extra: Record<string, string> = {
    ...safeAttributes(node.attributes),
    ...(node.cssId ? { id: node.cssId } : {}),
  };
  const rendered =
    Object.keys(extra).length && isValidElement(el)
      ? cloneElement(el, extra)
      : el;

  return <BlockErrorBoundary>{rendered}</BlockErrorBoundary>;
}
