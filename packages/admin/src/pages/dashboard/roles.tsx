import { Button } from "@revnixhq/ui";
import type React from "react";

import { Plus } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

import RoleTable from "./roles/components/RoleTable";

/**
 * RolesPage Component
 *
 * Main page for role management with CRUD operations.
 * Displays page header, "Add Role" button, and role table with search, pagination, and actions.
 *
 * ## Features
 * - Page header with title, description, "Add Role" button
 * - RoleTable component with ResponsiveTable (mobile card view, desktop table view)
 * - Consistent spacing via PageContainer
 * - Mobile responsive layout
 *
 * ## Design System Alignment (Sprint 2)
 * - PageContainer wrapper for consistent spacing (16px → 24px → 32px)
 * - Badge variants for role type and status
 * - TanStack Query integration (automatic caching, loading/error states)
 * - ResponsiveTable for mobile optimization
 *
 * @example
 * ```tsx
 * <RolesPage />
 * ```
 */
const RolesPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        {/* Breadcrumb navigation */}
        <div className="mb-6">
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
              { label: "Role Management" },
            ]}
          />
        </div>

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Roles</h1>
            <p className="text-sm font-normal text-primary/50 mt-1">
              Manage roles and permissions
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={ROUTES.SECURITY_ROLES_CREATE}>
              <Button size="sm" className="flex items-center gap-1">
                <Plus className="h-4 w-4" />
                <span>Add Role</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Role table */}
        <RoleTable />
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default RolesPage;
