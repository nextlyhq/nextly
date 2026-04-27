import { Button } from "@revnixhq/ui";
import React from "react";

import { UserBreadcrumbs } from "@admin/components/features/user-management/breadcrumbs";
import { Plus } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

import UserTable from "./components/UserTable";

/**
 * UsersPage Component
 *
 * Main page for user management with CRUD operations.
 * Displays page header, "Create User" button, and user table with search, pagination, and actions.
 *
 * ## Features
 * - Page header with title, description, "Create User" button
 * - Full-page Create User form (better for complex input and future extensibility)
 * - UserTable component with ResponsiveTable (mobile card view, desktop table view)
 * - Consistent spacing via PageContainer
 * - Mobile responsive layout
 *
 * ## UX Improvements (Sprint 2)
 * - Full-page forms for better user experience with complex forms
 * - Inline validation (prevent errors before submit)
 * - Optimistic updates via TanStack Query (instant feedback)
 * - Success toast + auto-navigation (seamless flow)
 *
 * @example
 * ```tsx
 * <UsersPage />
 * ```
 */
const UsersPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <div className="space-y-8">
          <UserBreadcrumbs currentPage="list" />

          {/* Page Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Users</h1>
              <p className="mt-2 text-base text-muted-foreground">
                Manage user accounts and permissions
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href={ROUTES.USERS_CREATE}>
                <Button size="sm" className="flex items-center gap-1">
                  <Plus className="h-4 w-4" />
                  <span>Create User</span>
                </Button>
              </Link>
            </div>
          </div>

          {/* User Table */}
          <div>
            <UserTable />
          </div>
        </div>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default UsersPage;
