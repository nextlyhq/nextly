import React, { Suspense } from "react";

import { LoginLoading } from "@admin/components/features/auth-login-skeleton";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { TargetSlot } from "@admin/components/shared/target-slot";
import { PublicLayout } from "@admin/layout/PublicLayout";

const Login = React.lazy(() =>
  import("@admin/components/features/auth-login").then(m => ({
    default: m.Login,
  }))
);

/** The login place tells its blocks nothing: nobody is signed in yet. */
const NO_CONTEXT: Record<string, never> = {};

const LoginPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PublicLayout>
        {/* The sign-in form is the `form` built-in, plugins' blocks around
            it in the order sent. Read from the public metadata: nobody is
            signed in here, so nothing on this place may need a permission. */}
        <TargetSlot
          place="login"
          context={NO_CONTEXT}
          builtIns={{
            form: (
              <Suspense fallback={<LoginLoading />}>
                <Login />
              </Suspense>
            ),
          }}
        />
      </PublicLayout>
    </QueryErrorBoundary>
  );
};

export default LoginPage;
