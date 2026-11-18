/**
 * A component shown on its own, as its editor draws it: each block following
 * one of its settings shows the setting's default, the value (and binding)
 * of the setting's own block, as a placement setting nothing shows it.
 *
 * @module setting-defaults
 */
import type { BlockDocument, BlockNode } from "./document";
import { isPlainRecord } from "./plain-record";
import { editedProps } from "./resolve-instances-exposures";
import { defineEntry, ownEntry, ownKeys } from "./safe-record";
import {
  followerFills,
  type FollowerFill,
  withoutSettingBindings,
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
  only?: string
): D {
  if (document.kind !== "component") return document;
  // Nothing is done to a setting's block when no placement is there.
  const fills = followerFills(document, () => ({})).filter(
    fill => only === undefined || fill.settingId === only
  );
  if (fills.length === 0) return document;
  const byNode = new Map<string, FollowerFill[]>();
  for (const fill of fills) {
    byNode.set(fill.nodeId, [...(byNode.get(fill.nodeId) ?? []), fill]);
  }
  return { ...document, nodes: filledForest(document.nodes, byNode) };
}

/** A forest with each follower in it filled, slot content included. */
function filledForest(
  nodes: BlockNode[],
  byNode: ReadonlyMap<string, readonly FollowerFill[]>
): BlockNode[] {
  return nodes.map(node => {
    if (!isPlainRecord(node)) return node;
    const filled = filledNode(node, byNode.get(node.id));
    if (!isPlainRecord(node.slots)) return filled;
    const slots: Record<string, BlockNode[]> = {};
    for (const name of ownKeys(node.slots)) {
      const children: unknown = ownEntry(node.slots, name);
      defineEntry(
        slots,
        name,
        Array.isArray(children)
          ? filledForest(children as BlockNode[], byNode)
          : children
      );
    }
    return { ...filled, slots };
  });
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
  const bindings: Record<string, unknown> = { ...node.bindings };
  for (const fill of fills) {
    if (fill.own !== undefined) defineEntry(bindings, fill.prop, fill.own);
  }
  const kept = withoutSettingBindings(bindings);
  const { bindings: _stored, ...rest } = node;
  return kept === undefined
    ? { ...rest, props }
    : { ...rest, props, bindings: kept as BlockNode["bindings"] };
}
