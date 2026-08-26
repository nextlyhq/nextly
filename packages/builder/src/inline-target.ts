/**
 * Finding a block's values that may be edited in place, and choosing among them.
 *
 * Shared by the plain and rich surfaces because both are asked the same
 * question in the same two ways: a pointer names the value it landed on, and a
 * keyboard names none — it has a selected block and expects the block's first.
 *
 * One statement of "first" is the point. Two would agree until one of them
 * started sorting, filtering or preferring differently, and the disagreement
 * would show as a keyboard shortcut opening a different value from the one a
 * double-click opens on the same block.
 *
 * The walk that finds them is here for the same reason. Both surfaces ask the
 * same node the same three questions — is it there, is it locked, is its block
 * registered — and a second copy of that is a second place for a lock to stop
 * being honoured. A lock honoured at one entry point and not another is the
 * state where an author believes a block is protected and it is not.
 *
 * @module inline-target
 */

import {
  findNode,
  getBlock,
  type BlockDocument,
  type BlockNode,
  type PropSchema,
} from "@nextlyhq/blocks-engine";

import { inlinePropKind, type InlinePropKind } from "./inline-prop-kind";
import { isLocked } from "./locking";

/** A node and the values on it a given surface may edit. */
export interface InlineProps {
  readonly node: BlockNode;
  /** The matching names with their schemas, in the order the block declared them. */
  readonly entries: readonly (readonly [string, PropSchema | undefined])[];
}

/**
 * The values on this node that may be edited in place AS ONE KIND, or `null`
 * when the node cannot be edited at all.
 *
 * `null` rather than an empty list for a node that is missing, locked or of an
 * unregistered type, so a caller can tell "this block offers none of yours"
 * from "this block is not editable" — the first is ordinary and the second is
 * what a lock means.
 *
 * @param document - the document being edited
 * @param nodeId - the node to ask about
 * @param kind - which surface is asking
 * @returns the node and its matching values, or `null`
 */
export function inlinePropsOfKind(
  document: BlockDocument,
  nodeId: string,
  kind: InlinePropKind
): InlineProps | null {
  const node = findNode(document.nodes, nodeId);
  if (node === undefined || isLocked(node)) return null;
  const definition = getBlock(node.type);
  if (definition === undefined) return null;
  const props = definition.props ?? {};
  return {
    node,
    entries: Object.keys(props)
      .filter(name => inlinePropKind(props[name]) === kind)
      .map(name => [name, props[name]] as const),
  };
}

/**
 * The value a caller asked for, or the block's first when it named none.
 *
 * `undefined` when the block offers nothing, and when it offers something other
 * than the name asked for — the caller decides what that means, because for one
 * surface it means "not mine" and for the other it means "not editable".
 *
 * @param targets - the block's editable values, in the order it declared them
 * @param prop - the value's name, or nothing to take the first
 * @returns the chosen value, or `undefined`
 */
export function namedTarget<T extends { readonly prop: string }>(
  targets: readonly T[],
  prop: string | undefined
): T | undefined {
  return prop === undefined ? targets[0] : targets.find(t => t.prop === prop);
}
