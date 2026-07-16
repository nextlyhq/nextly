import React, { Suspense } from "react";

import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { PublicLayout } from "@admin/layout/PublicLayout";

const AcceptInvite = React.lazy(() =>
  import("@admin/components/features/auth-accept-invite").then(m => ({
    default: m.AcceptInvite,
  }))
);

interface AcceptInvitePageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

const AcceptInvitePage: React.FC<AcceptInvitePageProps> = ({
  searchParams,
}) => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PublicLayout>
        <Suspense fallback={<div />}>
          <AcceptInvite searchParams={searchParams} />
        </Suspense>
      </PublicLayout>
    </QueryErrorBoundary>
  );
};

export default AcceptInvitePage;
