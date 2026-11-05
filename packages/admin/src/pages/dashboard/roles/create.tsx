import type { JSX } from "react";

import { RoleBreadcrumbs } from "@admin/components/features/role-management/breadcrumbs";
import { RoleForm } from "@admin/components/features/role-management/RoleForm";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";

export default function CreateRolePage(): JSX.Element {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      {/* Wide: a row holds a collection's name, its levels side by side and
          its switch, which a form's width cannot. */}
      <PageContainer width="wide">
        <RoleBreadcrumbs currentPage="create" />

        <RoleForm />
      </PageContainer>
    </QueryErrorBoundary>
  );
}
