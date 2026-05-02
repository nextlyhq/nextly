import { Button } from "@revnixhq/ui";
import type React from "react";

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
        <div>
          <div className="mb-6">
            <UserBreadcrumbs currentPage="list" />
          </div>

          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Users</h1>
              <p className="text-sm font-normal text-primary/50 mt-1">
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
