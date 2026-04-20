import { RoleBreadcrumbs } from "@admin/components/features/role-management/breadcrumbs";
import { RoleForm } from "@admin/components/features/role-management/RoleForm";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { useRouter } from "@admin/hooks/useRouter";

export default function EditRolePage() {
  const { route } = useRouter();
  // Extract roleId from path params (e.g., /admin/security/roles/edit/123)
  const roleId =
    route?.params?.id && typeof route.params.id === "string"
      ? route.params.id
      : undefined;

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <RoleBreadcrumbs currentPage="edit" />

        <RoleForm roleId={roleId} />
      </PageContainer>
    </QueryErrorBoundary>
  );
}
