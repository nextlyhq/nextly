import React, { Suspense } from "react";

import { SignupLoading as RegisterLoading } from "@admin/components/features/auth-signup-skeleton";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { PublicLayout } from "@admin/layout/PublicLayout";

const Signup = React.lazy(() =>
  import("@admin/components/features/auth-signup").then(m => ({
    default: m.Signup,
  }))
);

const RegisterPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PublicLayout>
        <Suspense fallback={<RegisterLoading />}>
          <Signup />
        </Suspense>
      </PublicLayout>
    </QueryErrorBoundary>
  );
};

export default RegisterPage;
