/**
 * A collection entry's version history, as a page.
 *
 * Accessible via /admin/collections/[slug]/[id]/versions, optionally with the
 * pair to compare in the query (`?from=&to=`).
 *
 * A wrapper rather than an implementation: the collection and single routes
 * show the same page, and keeping two copies is how they drift.
 *
 * @module pages/dashboard/entries/[slug]/[id]/versions
 */

import { readVersionParam } from "@admin/components/features/versions/version-search-params";
import { VersionComparePage } from "@admin/components/features/versions/VersionComparePage";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import type { PageProps } from "@admin/lib/routing";

export default function EntryVersionsPage({ params, searchParams }: PageProps) {
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const id = typeof params?.id === "string" ? params.id : "";

  return (
    <VersionComparePage
      scope={{ kind: "collection", slug, entryId: id }}
      documentHref={buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, { slug, id })}
      // Reaching this page needs `read-${slug}`; the editor needs
      // `update-${slug}`. The entry list needs only the former, so it is where a
      // read-only viewer can actually go back to.
      readOnlyHref={buildRoute(ROUTES.COLLECTION_ENTRIES, { slug })}
      from={readVersionParam(searchParams?.from)}
      to={readVersionParam(searchParams?.to)}
    />
  );
}
