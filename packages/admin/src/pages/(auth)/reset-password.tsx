import React, { Suspense } from "react";

import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { PublicLayout } from "@admin/layout/PublicLayout";

const ResetPassword = React.lazy(() =>
  import("@admin/components/features/auth-reset-password").then(m => ({
    default: m.ResetPassword,
  }))
);

interface ResetPasswordPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({
  searchParams,
}) => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PublicLayout>
        <Suspense fallback={<div />}>
          <ResetPassword searchParams={searchParams} />
        </Suspense>
      </PublicLayout>
    </QueryErrorBoundary>
  );
};

export default ResetPasswordPage;
