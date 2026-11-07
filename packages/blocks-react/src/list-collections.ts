/**
 * The collections a page's lists draw, read from the page's documents.
 *
 * Here rather than in the `/next` subpath, so the published route and an
 * editor drawing the same page ask one walk which lists the page holds: the
 * route reads the field shapes of the collections it finds, and the editor
 * asks for the same ones.
 *
 * @module list-collections
 */
import {
  readListQuery,
  resolveNodeBindings,
  type BindingRun,
  type BlockDocument,
  type BlockNode,
  type ListQuery,
} from "@nextlyhq/blocks-engine";

import { collectionLoop } from "./blocks/collection-loop";

/**
 * The collections the page's lists read that `wanted` keeps, each list's
 * query read as the engine reads it. One walk for every question about the
 * page's lists, so no two of them disagree about which lists a page holds.
 */
export function listCollectionsWhere(
  documents: readonly BlockDocument[],
  wanted: (query: ListQuery, list: BlockNode) => boolean,
  run?: BindingRun
): Set<string> {
  const found = new Set<string>();
  const stack: BlockNode[] = documents.flatMap(document => [...document.nodes]);
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.type === collectionLoop.name) {
      const { query } = readListQuery(listPropsAsBound(node, run));
      if (query.collection !== undefined && wanted(query, node)) {
        found.add(query.collection);
      }
    }
    for (const children of Object.values(node.slots ?? {})) {
      stack.push(...children);
    }
  }
  return found;
}

/**
 * A list's props as the page's binding pass fills them, so a list whose
 * collection an entry binding names is asked about that collection, the one
 * it draws, rather than the fallback stored beside the binding. A binding to
 * a list item is filled only as an item is drawn, so it leaves its prop as
 * stored here.
 */
export function listPropsAsBound(
  list: BlockNode,
  run: BindingRun | undefined
): Record<string, unknown> {
  if (run === undefined || list.bindings === undefined) return list.props;
  return resolveNodeBindings(list, run, { phase: "page" }).props;
}

/**
 * The collections the page's lists draw, whose items its bindings read.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function listCollections(
  documents: readonly BlockDocument[]
): Set<string> {
  return listCollectionsWhere(documents, () => true);
}
