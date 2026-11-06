/**
 * What a component placement stores, read defensively.
 *
 * A placement is one node of the engine's instance type whose props name the
 * component it draws. Two readers need that id — the instance inspector, which
 * edits the placement, and the layers tree, which names it — and they must
 * read it the same way. Kept apart from both because each imports a module
 * that imports the other's.
 *
 * @module placement-props
 */

import type { BlockNode } from "@nextlyhq/blocks-engine";

/**
 * The component id the node stores, or an empty string for a node that names
 * none.
 *
 * Read defensively: a stored document can hold anything the database
 * returned, and a `componentId` that is not a string must not reach a lookup
 * typed for one. An empty id resolves to no definition, which the panel then
 * says.
 */
export function storedComponentId(node: BlockNode): string {
  const id = instanceProps(node).componentId;
  return typeof id === "string" ? id : "";
}

/**
 * The instance's props as a record, or an empty one.
 *
 * A stored document can hold an instance whose `props` is missing or is not a
 * record — an import, a hook, a hand edit — and the canvas draws it as a
 * malformed placeholder rather than failing. Selecting that placeholder must
 * not throw either, so every read of an instance's props goes through this
 * one guard, which is how the resolver reads them too.
 */
export function instanceProps(node: BlockNode): Record<string, unknown> {
  const props: unknown = node.props;
  return typeof props === "object" && props !== null && !Array.isArray(props)
    ? (props as Record<string, unknown>)
    : {};
}
