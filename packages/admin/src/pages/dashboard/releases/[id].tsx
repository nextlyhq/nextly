"use client";

/**
 * One release, at `/admin/releases/[id]`.
 *
 * A page of its own rather than a panel on the list, because scheduling is
 * decided with the contents on screen and a panel cannot hold both. It is also
 * what makes a release LINKABLE — the way an editor asks a colleague "is this
 * what goes out on Friday?".
 *
 * @module pages/dashboard/releases/[id]
 */

import { ReleaseDetail } from "@admin/components/features/releases/ReleaseDetail";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

interface ReleaseDetailPageProps {
  params?: { id?: string };
}

export default function ReleaseDetailPage({ params }: ReleaseDetailPageProps) {
  const id = typeof params?.id === "string" ? params.id : undefined;

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <Link
          href={ROUTES.RELEASES}
          className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          ← All releases
        </Link>
        {id ? (
          <ReleaseDetail id={id} />
        ) : (
          // The route matched without a value, which is a malformed link rather
          // than a missing release — said as such so nobody goes looking for a
          // release that was never named.
          <p role="alert" className="text-sm text-destructive">
            This link does not name a release.
          </p>
        )}
      </PageContainer>
    </QueryErrorBoundary>
  );
}
