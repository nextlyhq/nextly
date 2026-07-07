/**
 * Pure helpers for Query Loop authoring (spec §5). React/@dnd-kit free so the tree walk,
 * field derivation, and sort encoding stay unit-tested.
 */
import type { BlockNode } from "../../core/types";
import { QUERY_LOOP_TYPE } from "../../render/query/types";

/** The nearest ancestor `core/query-loop` that contains `id` (excludes the node itself). */
export function findEnclosingLoop(
  root: BlockNode,
  id: string
): BlockNode | undefined {
  let found: BlockNode | undefined;
  const visit = (node: BlockNode, loop: BlockNode | undefined): boolean => {
    if (node.id === id) {
      found = loop;
      return true;
    }
    const nextLoop = node.type === QUERY_LOOP_TYPE ? node : loop;
    if (node.slots) {
      for (const children of Object.values(node.slots)) {
        for (const child of children) {
          if (visit(child, nextLoop)) return true;
        }
      }
    }
    return false;
  };
  visit(root, undefined);
  return found;
}

/** Union of keys across sample rows, in stable sorted order. */
export function deriveFieldNames(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const k of Object.keys(row)) keys.add(k);
    }
  }
  return [...keys].sort();
}

export type SortDir = "asc" | "desc";

/** Encode a field + direction into the API sort string (`-field` = desc). */
export function buildSort(field: string, dir: SortDir): string {
  if (!field) return "";
  return dir === "desc" ? `-${field}` : field;
}

/** Decode an API sort string back into field + direction. */
export function parseSort(sort: string): { field: string; dir: SortDir } {
  if (!sort) return { field: "", dir: "asc" };
  return sort.startsWith("-")
    ? { field: sort.slice(1), dir: "desc" }
    : { field: sort, dir: "asc" };
}
