import { RoleBreadcrumbs } from "@admin/components/features/role-management/breadcrumbs";
import { RoleForm } from "@admin/components/features/role-management/RoleForm";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";

export default function CreateRolePage() {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <RoleBreadcrumbs currentPage="create" />

        <RoleForm />
      </PageContainer>
    </QueryErrorBoundary>
  );
}
