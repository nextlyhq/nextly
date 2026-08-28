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

import { useVersionDocumentTitle } from "@admin/components/features/versions/useVersionDocumentTitle";
import {
  readLocaleParam,
  readVersionParam,
} from "@admin/components/features/versions/version-search-params";
import { VersionComparePage } from "@admin/components/features/versions/VersionComparePage";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import type { PageProps } from "@admin/lib/routing";

export default function EntryVersionsPage({ params, searchParams }: PageProps) {
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const id = typeof params?.id === "string" ? params.id : "";
  // Without this the page announces itself only as "Version history", while the
  // URL carries an opaque id and the dashboard header shows no breadcrumbs — so
  // a reader cannot tell which entry the snapshots belong to without leaving.
  // The language the address names, so a link shared from a French history
  // opens the French comparison under the French title regardless of what the
  // reader's editor was last set to.
  const locale = readLocaleParam(searchParams?.locale);
  const documentTitle = useVersionDocumentTitle(
    { kind: "collection", slug, entryId: id },
    locale
  );

  return (
    <VersionComparePage
      scope={{ kind: "collection", slug, entryId: id }}
      documentHref={buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, { slug, id })}
      documentTitle={documentTitle}
      // Reaching this page needs `read-${slug}`; the editor needs
      // `update-${slug}`. The entry list needs only the former, so it is where a
      // read-only viewer can actually go back to.
      readOnlyHref={buildRoute(ROUTES.COLLECTION_ENTRIES, { slug })}
      from={readVersionParam(searchParams?.from)}
      to={readVersionParam(searchParams?.to)}
    />
  );
}
