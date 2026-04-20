import { Button } from "@revnixhq/ui";
import React from "react";

import { Plus, ChevronRight, Home } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
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
        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex items-center gap-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <Link
                href={ROUTES.DASHBOARD}
                className="flex items-center gap-1 hover-unified"
              >
                <Home className="h-4 w-4" />
                <span>Dashboard</span>
              </Link>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
            </li>
            <li className="text-foreground font-medium">Roles</li>
          </ol>
        </nav>

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Roles</h1>
            <p className="text-muted-foreground">
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
