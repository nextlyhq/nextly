/**
 * "More exist", under a list card that drew fewer rows than its answer held.
 *
 * For a list drawn from one collection it is a link to that collection's list view, carrying the
 * card's own filter and sort, so the reader lands on the rows the card was showing and the rest
 * of them. A list from anything else (a system or plugin source) says that more exist and links
 * nowhere: there is no one list view that would show the same rows.
 *
 * @module components/features/widgets/archetypes/more-exist
 */

import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";

import type { ArchetypeBody } from "./types";

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
export function moreExistHref(query: CardQuery): string | undefined {
  const slug = collectionSlugOf(query?.source);
  if (slug === undefined) return undefined;
  const path = buildRoute(ROUTES.COLLECTION_ENTRIES, { slug });
  const search = listViewSearch(query).toString();
  return search === "" ? path : `${path}?${search}`;
}

/** The collection a `collection:<slug>` source id names, or `undefined` for any other source. */
function collectionSlugOf(source: string | undefined): string | undefined {
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
  const where = query?.where;
  const sort = query?.sort;
  const status = query?.status ?? "published";
  if (where && Object.keys(where).length > 0)
    params.set("where", JSON.stringify(where));
  if (typeof sort === "string" && sort !== "") params.set("sort", sort);
  if (status !== "all") params.set("status", status);
  return params;
}

export function MoreExist({ query }: { query: CardQuery }) {
  const href = moreExistHref(query);
  return href ? (
    <Link
      href={href}
      className="text-xs font-medium text-primary hover:underline"
    >
      More exist
    </Link>
  ) : (
    <p className="text-xs text-muted-foreground">More exist</p>
  );
}
