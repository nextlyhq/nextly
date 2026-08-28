/**
 * A single's version history, as a page.
 *
 * Accessible via /admin/singles/[slug]/versions, optionally with the pair to
 * compare in the query (`?from=&to=`). Wraps the same page the collection
 * route shows.
 *
 * A single is addressed by slug, but its version scope also carries the live
 * document's id — not to reach the server, which resolves the document itself,
 * but so a client cache can tell one incarnation of a Single from a recreated
 * one. So this route reads the document before it can name the scope.
 *
 * @module pages/dashboard/singles/[slug]/versions
 */

import { useVersionDocumentTitle } from "@admin/components/features/versions/useVersionDocumentTitle";
import { readVersionParam } from "@admin/components/features/versions/version-search-params";
import { VersionComparePage } from "@admin/components/features/versions/VersionComparePage";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useSingleDocument } from "@admin/hooks/queries/useSingles";
import type { PageProps } from "@admin/lib/routing";

export default function SingleVersionsPage({
  params,
  searchParams,
}: PageProps) {
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const document = useSingleDocument(slug);
  const documentId = document.data?.id;
  // Read BEFORE the guard below, because a hook cannot be called after an early
  // return. It needs only the slug, which is why it asks for less than a scope.
  const documentTitle = useVersionDocumentTitle({ kind: "single", slug });

  // Nothing is rendered until the document's identity is known: a scope built
  // with a placeholder id would key the cache to a document that does not
  // exist, and the comparison it served would belong to nothing.
  if (documentId === undefined) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          {document.isError
            ? "This document could not be loaded."
            : "Loading history…"}
        </p>
      </div>
    );
  }

  return (
    <VersionComparePage
      scope={{ kind: "single", slug, documentId: String(documentId) }}
      documentHref={buildRoute(ROUTES.SINGLE_EDIT, { slug })}
      documentTitle={documentTitle}
      // Reaching this page needs `read-${slug}`; the single's own editor needs
      // `update-${slug}`. `/admin/singles` is NOT the readable alternative it
      // looks like: it redirects straight to the first single the viewer can
      // READ, and that destination is guarded on `update-`. So a read-only
      // viewer would land on permission-denied by a longer route. The dashboard
      // is reachable by anyone who can reach this page at all.
      readOnlyHref={ROUTES.DASHBOARD}
      from={readVersionParam(searchParams?.from)}
      to={readVersionParam(searchParams?.to)}
    />
  );
}
