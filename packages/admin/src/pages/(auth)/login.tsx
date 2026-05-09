import React, { Suspense } from "react";

import { LoginLoading } from "@admin/components/features/auth-login-skeleton";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { PublicLayout } from "@admin/layout/PublicLayout";

const Login = React.lazy(() =>
  import("@admin/components/features/auth-login").then(m => ({
    default: m.Login,
  }))
);

const LoginPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PublicLayout>
        <Suspense fallback={<LoginLoading />}>
          <Login />
        </Suspense>
      </PublicLayout>
    </QueryErrorBoundary>
  );
};

export default LoginPage;
