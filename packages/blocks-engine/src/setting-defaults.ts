/**
 * A component shown on its own, as its editor draws it: each block following
 * one of its settings shows the setting's default, the value (and binding)
 * of the setting's own block, as a placement setting nothing shows it.
 *
 * @module setting-defaults
 */
import type { BlockDocument, BlockNode } from "./document";
import { DEFAULT_LIMITS } from "./limits";
import { isPlainRecord } from "./plain-record";
import { editedProps } from "./resolve-instances-exposures";
import { defineEntry, ownEntry, ownKeys } from "./safe-record";
import {
  followerFills,
  type FollowerFill,
  type FollowerLimits,
} from "./setting-bindings";

/**
 * The component with each follower filled from its setting's default, or
 * only those following `only`; the input itself when it is no component or
 * nothing follows a setting.
 *
 * Also how a setting is taken away: each block following it keeps what it
 * showed, the setting's default, and follows nothing from then on.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function withSettingDefaults<D extends BlockDocument>(
  document: D,
  only?: string,
  limits: FollowerLimits = DEFAULT_LIMITS
): D {
  if (document.kind !== "component") return document;
  // Nothing is done to a setting's block when no placement is there.
  const fills = followerFills(document, () => ({}), limits).filter(
    fill => only === undefined || fill.settingId === only
  );
  if (fills.length === 0) return document;
  const byNode = new Map<string, FollowerFill[]>();
  for (const fill of fills) {
    byNode.set(fill.nodeId, [...(byNode.get(fill.nodeId) ?? []), fill]);
  }
  const budget = { left: limits.maxNodes, depth: limits.maxDepth };
  return { ...document, nodes: filledForest(document.nodes, byNode, budget) };
}

/** A forest with each follower in it filled, slot content included. */
function filledForest(
  nodes: BlockNode[],
  byNode: ReadonlyMap<string, readonly FollowerFill[]>,
  /**
   * The nodes left to copy, as many as the fills were found under: past it a
   * forest is handed back as it is, never walked, so a stored chain deeper
   * than the cap costs nothing and cannot exhaust the stack.
   */
  budget: { left: number; depth: number }
): BlockNode[] {
  if (budget.left <= 0 || budget.depth <= 0) return nodes;
  budget.depth -= 1;
  const filled = nodes.map(node => {
    if (!isPlainRecord(node) || budget.left <= 0) return node;
    budget.left -= 1;
    const filled = filledNode(node, byNode.get(node.id));
    if (!isPlainRecord(node.slots)) return filled;
    const slots: Record<string, BlockNode[]> = {};
    for (const name of ownKeys(node.slots)) {
      const children: unknown = ownEntry(node.slots, name);
      defineEntry(
        slots,
        name,
        Array.isArray(children)
          ? filledForest(children as BlockNode[], byNode, budget)
          : children
      );
    }
    return { ...filled, slots };
  });
  budget.depth += 1;
  return filled;
}

/** One block with its fills: each prop's value, and its binding or none. */
function filledNode(
  node: BlockNode,
  fills: readonly FollowerFill[] | undefined
): BlockNode {
  if (fills === undefined) return node;
  const props = editedProps(
    node.props,
    fills.map(fill => ({
      path: fill.prop,
      value: fill.value,
      unset: fill.unset,
    }))
  );
  // Only the filled props: another binding of the block, following another
  // setting, is left as it is.
  const bindings: Record<string, unknown> = {};
  const filled = new Map(fills.map(fill => [fill.prop, fill]));
  const stored: Record<string, unknown> = isPlainRecord(node.bindings)
    ? node.bindings
    : {};
  for (const key of ownKeys(stored)) {
    const fill = filled.get(key);
    const kept = fill === undefined ? ownEntry(stored, key) : fill.own;
    if (kept !== undefined) defineEntry(bindings, key, kept);
  }
  const { bindings: _stored, ...rest } = node;
  return ownKeys(bindings).length === 0
    ? { ...rest, props }
    : { ...rest, props, bindings: bindings as BlockNode["bindings"] };
}
