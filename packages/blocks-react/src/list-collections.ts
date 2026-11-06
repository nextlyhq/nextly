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
  wanted: (query: ListQuery) => boolean
): Set<string> {
  const found = new Set<string>();
  const stack: BlockNode[] = documents.flatMap(document => [...document.nodes]);
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.type === collectionLoop.name) {
      const { query } = readListQuery(node.props);
      if (query.collection !== undefined && wanted(query)) {
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
 * The collections the page's lists draw, whose items its bindings read.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function listCollections(
  documents: readonly BlockDocument[]
): Set<string> {
  return listCollectionsWhere(documents, () => true);
}
