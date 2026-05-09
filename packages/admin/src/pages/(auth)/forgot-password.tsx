import React, { Suspense } from "react";

import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { PublicLayout } from "@admin/layout/PublicLayout";

const ForgotPassword = React.lazy(() =>
  import("@admin/components/features/auth-forgot-password").then(m => ({
    default: m.ForgotPassword,
  }))
);

const ForgotPasswordPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PublicLayout>
        <Suspense fallback={<div />}>
          <ForgotPassword />
        </Suspense>
      </PublicLayout>
    </QueryErrorBoundary>
  );
};

export default ForgotPasswordPage;
