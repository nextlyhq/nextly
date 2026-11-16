/**
 * A list split into pages: how many pages its count makes, the lists a
 * document holds, the one list a page's address pages, and whether a list
 * may be split at all.
 *
 * @module list-query-pages
 */
import { COLLECTION_LIST_TYPE } from "./list-query-contract";
import { readListQuery } from "./list-query-read";
import { isPlainRecord } from "./plain-record";

/**
 * How many pages a list split into pages has: the entries after the skipped
 * ones, `limit` to a page, and never fewer than one, which shows the list's
 * empty state when nothing is left. The one count the route, the renderer's
 * links and the editor share, so none of them names a page the others do not.
 */
export function listPageCount(
  matching: number,
  offset: number,
  limit: number
): number {
  const left = Math.max(0, matching - offset);
  return Math.max(1, Math.ceil(left / Math.max(1, limit)));
}

/**
 * The ids of the nodes inside a list, in any of its slots: what it draws per
 * entry and its empty state alike. Bounded by `maxNodes`.
 */
// RELOCATED, not written here — see the docblock of `list-query.ts`.
// fallow-ignore-next-line complexity
export function idsInsideLists(
  nodes: readonly unknown[],
  maxNodes: number
): Set<string> {
  const inside = new Set<string>();
  const stack: { node: unknown; listed: boolean }[] = [...nodes]
    .reverse()
    .map(node => ({ node, listed: false }));
  let left = maxNodes;
  for (let visit = stack.pop(); visit !== undefined; visit = stack.pop()) {
    if (left <= 0) break;
    left -= 1;
    const { node } = visit;
    if (!isPlainRecord(node)) continue;
    if (visit.listed && typeof node.id === "string") inside.add(node.id);
    const listed = visit.listed || node.type === COLLECTION_LIST_TYPE;
    const slots = node.slots;
    if (!isPlainRecord(slots)) continue;
    for (const name of Object.keys(slots).reverse()) {
      const children = slots[name];
      if (!Array.isArray(children)) continue;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ node: children[index], listed });
      }
    }
  }
  return inside;
}

/** The list on a page that is split into pages, as its node holds it. */
export interface PaginatedList {
  readonly id: string;
  /** The author's name for the list, when it has one. */
  readonly name?: string;
  readonly props: Readonly<Record<string, unknown>>;
}

/**
 * The list a page's address pages, or undefined when none is split into
 * pages: the first, in document order, of the lists split into pages that
 * are not inside another list and read a collection rather than related
 * entries. Every other list split into pages is one validation refuses, and
 * one that reaches the renderer anyway shows its first page alone.
 *
 * Bounded by `maxNodes`, and reading only plain records, because a stored
 * document is whatever the database returned.
 *
 * `propsOf` reads a list's props in place of the ones it stores, so a caller
 * that fills a list's bindings judges it as drawn: a list whose split into
 * pages is bound to an entry's value pages where that value is true, and the
 * answer carries the props as read. Every other node is walked as stored.
 */
// RELOCATED, not written here — see the docblock of `list-query.ts`.
// fallow-ignore-next-line complexity
export function paginatedList(
  nodes: readonly unknown[],
  maxNodes: number = Number.MAX_SAFE_INTEGER,
  propsOf: (list: Readonly<Record<string, unknown>>) => unknown = list =>
    list.props
): PaginatedList | undefined {
  const stack: unknown[] = [...nodes].reverse();
  let left = maxNodes;
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (left <= 0) return undefined;
    left -= 1;
    if (!isPlainRecord(node)) continue;
    if (node.type === COLLECTION_LIST_TYPE) {
      const props = propsOf(node);
      const { query } = readListQuery(props);
      if (
        query.paginate === true &&
        query.relation === undefined &&
        typeof node.id === "string"
      ) {
        return {
          id: node.id,
          ...(typeof node.name === "string" && node.name.trim() !== ""
            ? { name: node.name.trim() }
            : {}),
          props: isPlainRecord(props) ? props : {},
        };
      }
    }
    // Nothing inside a list pages: what it draws per entry repeats once per
    // outer entry, and its empty state is drawn only when it has none, so
    // neither is always on the page its address serves.
    if (node.type === COLLECTION_LIST_TYPE) continue;
    const slots = node.slots;
    if (!isPlainRecord(slots)) continue;
    for (const name of Object.keys(slots).reverse()) {
      const children = slots[name];
      if (Array.isArray(children)) {
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push(children[index]);
        }
      }
    }
  }
  return undefined;
}

/**
 * The list a page's address may page, judged from the stored document
 * alone: the one {@link paginatedList} finds, taking a list whose split into
 * pages is bound to the entry as split, since only a page's binding pass
 * settles whether it is. A page with none pages nothing whatever its entry
 * holds; one with a bound split may. What a caller that cannot run the
 * binding pass (a save, the route before it reads anything) asks.
 *
 * @experimental Settles with list pagination.
 */
export function mayPaginateList(
  nodes: readonly unknown[],
  maxNodes: number = Number.MAX_SAFE_INTEGER
): PaginatedList | undefined {
  return paginatedList(nodes, maxNodes, list =>
    isPlainRecord(list.bindings) && "paginate" in list.bindings
      ? { ...(isPlainRecord(list.props) ? list.props : {}), paginate: true }
      : list.props
  );
}
