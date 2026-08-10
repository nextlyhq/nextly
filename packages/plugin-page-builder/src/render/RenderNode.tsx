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
import { nodeClassName } from "@nextlyhq/blocks-engine";
import { cloneElement, isValidElement, type ReactNode } from "react";

import { resolveBindings } from "../core/bindings";
import type { BlockRegistry } from "../core/registry";
import { documentKey, refScopedKey } from "../core/style-compiler";
import type { BlockNode } from "../core/types";
import type { RemotePatternInput } from "../core/url-policy";

import type { DataProvider } from "./dataProvider";
import { BlockErrorBoundary } from "./ErrorBoundary";
import { QueryLoop } from "./query/QueryLoop";
import type { QueryBudget } from "./query/runQuery";
import { QUERY_LOOP_TYPE } from "./query/types";

const BLOCKED_ATTRS = new Set(["style", "srcdoc", "class", "classname"]);

/**
 * Attributes the browser resolves on its own.
 *
 * These are applied by `cloneElement` AFTER the block has rendered, so a custom
 * attribute here overwrites the value the block already put through the origin
 * policy — an author-supplied `src` silently replaces the checked one and
 * reaches any host it names. A block sets the ones it needs itself, so there is
 * nothing to allow: overriding them is only ever a way around the gate.
 *
 * `data` is the `<object>` attribute, matched exactly; `data-*` is untouched.
 */
const FETCH_ATTRS = new Set([
  "src",
  "srcset",
  "poster",
  "background",
  "data",
  "lowsrc",
]);

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
    if (FETCH_ATTRS.has(key)) continue;
    out[k] = String(v);
  }
  return out;
}

export interface RenderNodeProps {
  node: BlockNode;
  registry: BlockRegistry;
  dataProvider?: DataProvider;
  /** Hosts this page may load media from; passed to every block's render args. */
  remotePatterns?: readonly RemotePatternInput[];
  /** Current Query Loop item — threaded to resolve bindings at any depth. */
  item?: Record<string, unknown>;
  /** Remaining query budget shared across nested loops on this page render. */
  budget?: QueryBudget;
  /** Reusable-block library: refId → stored subtree (spec §H). */
  refs?: Record<string, BlockNode>;
  /** Visited ref ids on the current path — guards against reference cycles. */
  refStack?: string[];
  /**
   * The document's node classes, from `documentNodeClasses`.
   *
   * Threaded rather than read from context for the same reason `item` is:
   * Server Components cannot consume context. It has to be the map the
   * stylesheet was compiled from, because a class disambiguated in one and not
   * the other names a selector the markup never carries.
   *
   * It spans the document's own ids AND one ref-scoped key per node of every
   * reusable block, so a library node and a document node holding the same id
   * are named apart rather than sharing a class.
   */
  classes?: ReadonlyMap<string, string>;
  /**
   * The ref id whose library subtree this node belongs to, when it belongs to
   * one.
   *
   * Absent for the document's own nodes. Set at each `core/ref` boundary and
   * carried down the subtree, so a node is named by the block it lives in
   * rather than by the path taken to reach it — a nested reusable block
   * resolves to the same names whether it was placed directly or through
   * another block, and one rule serves every placement.
   */
  refScope?: string;
}

const REF_TYPE = "core/ref";

export function RenderNode({
  node,
  registry,
  dataProvider,
  remotePatterns,
  item,
  budget,
  refs,
  refStack,
  classes,
  refScope,
}: RenderNodeProps): ReactNode {
  // The same key the compiler names this node by. Deriving it differently on
  // either side writes a stylesheet against a selector the markup never carries.
  const styleKey =
    refScope === undefined || refScope === ""
      ? documentKey(node.id)
      : refScopedKey(refScope, node.id);
  const className = [
    classes?.get(styleKey) ?? nodeClassName(styleKey),
    node.customClass,
  ]
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
        remotePatterns={remotePatterns}
        item={item}
        budget={budget}
        refs={refs}
        refStack={[...(refStack ?? []), refId]}
        // The map DOES carry this subtree, under ref-scoped keys, so it is
        // threaded rather than withheld. Withholding it was the previous answer
        // and it did not work: for any id without a hash collision the plain
        // class and the map's entry are the same string, so a referenced node
        // sharing an id with a document node still wore that node's class.
        // Naming it apart is what separates them; the scope below is what does
        // the naming.
        classes={classes}
        refScope={refId}
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
          remotePatterns={remotePatterns}
          className={className}
          budget={budget ?? { n: 0 }}
          classes={classes}
          refScope={refScope}
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
          remotePatterns={remotePatterns}
          item={item}
          budget={budget}
          refs={refs}
          refStack={refStack}
          classes={classes}
          // Carried down, not reset: a child of a library node is still inside that reusable
          // block. Dropping it here would name the child from its bare id while its parent was
          // named from the ref, so the child would collide with a document node of the same id
          // and the parent would not — the original bug surviving one level down.
          refScope={refScope}
        />
      ));
    }
  }

  const props = item ? resolveBindings(node, item) : node.props;
  const el = def.render({ props, node, slots, className, remotePatterns });

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
