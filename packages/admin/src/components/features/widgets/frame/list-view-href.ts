/**
 * The list view that holds a card's rows and the rest of them, under the card's own filter, sort
 * and lifecycle: where a list card's "View all (N)" leads.
 *
 * For a list drawn from one collection it is that collection's list view. A list from anything
 * else (a system or plugin source) has no one list view that would show the same rows, so it has
 * no address, and its footer says how many more there are without linking.
 *
 * @module components/features/widgets/frame/list-view-href
 */

import { buildRoute, ROUTES } from "@admin/constants/routes";

import type { ArchetypeBody } from "../archetypes/types";

type CardQuery = Parameters<ArchetypeBody>[1]["query"];

/** The prefix of a source id that names one collection: `collection:<slug>`. */
const COLLECTION_SOURCE = "collection:";

/**
 * The collection list view showing a card's rows and the rest of them, or `undefined` for a
 * card that does not read one collection.
 *
 * Reads the source id's own grammar, `<kind>:<target>`, for its one kind that names a
 * collection; the filter goes as the `where` the list view parses, the sort as its `sort`.
 */
export function listViewHref(query: CardQuery): string | undefined {
  const slug = collectionSlugOf(query?.source);
  if (slug === undefined) return undefined;
  const path = buildRoute(ROUTES.COLLECTION_ENTRIES, { slug });
  const search = listViewSearch(query).toString();
  return search === "" ? path : `${path}?${search}`;
}

/** The collection a `collection:<slug>` source id names, or `undefined` for any other source. */
export function collectionSlugOf(
  source: string | undefined
): string | undefined {
  if (!source?.startsWith(COLLECTION_SOURCE)) return undefined;
  const slug = source.slice(COLLECTION_SOURCE.length);
  return slug === "" ? undefined : slug;
}

/**
 * The card's filter, sort and lifecycle, as the list view's `where`, `sort` and `status`; empty
 * ones are left out. The status is the card's own, or published when it left it to the widget
 * read's default; a card that read every entry names none, which is what the list shows anyway.
 * The list view ignores a status for a collection without the Draft / Published lifecycle.
 */
function listViewSearch(query: CardQuery): URLSearchParams {
  const params = new URLSearchParams();
  const entries: Array<[string, string | undefined]> = [
    ["where", whereParam(query?.where)],
    ["sort", sortParam(query?.sort)],
    ["status", statusParam(query?.status)],
  ];
  for (const [name, value] of entries) {
    if (value !== undefined) params.set(name, value);
  }
  return params;
}

/** A filter with conditions, as the list view's JSON `where`. */
function whereParam(where: unknown): string | undefined {
  return where && typeof where === "object" && Object.keys(where).length > 0
    ? JSON.stringify(where)
    : undefined;
}

/** A sort, as the list view's `sort`. */
function sortParam(sort: unknown): string | undefined {
  return typeof sort === "string" && sort !== "" ? sort : undefined;
}

/** The card's lifecycle, or published when it left it to the read's default; none for `all`. */
function statusParam(status: string | undefined): string | undefined {
  const scope = status ?? "published";
  return scope === "all" ? undefined : scope;
}
