import React, { Suspense } from "react";

import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { PublicLayout } from "@admin/layout/PublicLayout";

const VerifyEmail = React.lazy(() =>
  import("@admin/components/features/auth-verify-email").then(m => ({
    default: m.VerifyEmail,
  }))
);

interface VerifyEmailPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

const VerifyEmailPage: React.FC<VerifyEmailPageProps> = ({ searchParams }) => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PublicLayout>
        <Suspense fallback={<div />}>
          <VerifyEmail searchParams={searchParams} />
        </Suspense>
      </PublicLayout>
    </QueryErrorBoundary>
  );
};

export default VerifyEmailPage;
