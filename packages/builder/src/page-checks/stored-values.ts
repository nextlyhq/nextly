/**
 * How the checks read a block's stored value: whether it holds anything,
 * and whether a field supplies it instead. One reading, so the alt text and
 * the empty-block checks agree on what "left empty" means.
 *
 * @module page-checks/stored-values
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";

/** A stored value with something in it: a cleared text field holds nothing. */
export function holds(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  return value !== undefined && value !== null;
}

/** Whether a prop is bound to a field, which then supplies its value. */
export function bound(node: BlockNode, prop: string): boolean {
  return node.bindings?.[prop] !== undefined;
}
