import { Button, PageHeader } from "@nextlyhq/ui";
import type React from "react";

import { UserBreadcrumbs } from "@admin/components/features/user-management/breadcrumbs";
import { List, Plus } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { READ_SETTINGS } from "@admin/lib/permissions/system-policy";

import UserTable from "./components/UserTable";

/**
 * UsersPage Component
 *
 * Main page for user management with CRUD operations.
 * Displays page header, "Create User" button, and user table with search, pagination, and actions.
 *
 * ## Features
 * - Page header with title, description, "Create User" button, and a "Fields"
 *   action to the user fields screen for a reader who may open it
 * - Full-page Create User form (better for complex input and future extensibility)
 * - UserTable component with DataTableView (mobile card view, desktop table view)
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
  const { hasPermission } = useCurrentUserPermissions();
  // The grant the user fields route itself demands, so the action is offered
  // exactly to the readers that route admits. The fields screen has no entry
  // in the Settings panel; this action is the way to it.
  const canOpenUserFields = hasPermission(READ_SETTINGS);

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <div>
          <div className="mb-6 empty:hidden">
            <UserBreadcrumbs currentPage="list" />
          </div>

          {/* Page Header */}
          <PageHeader
            title="Users"
            description="Manage user accounts and permissions"
            actions={
              <>
                <div className="flex items-center gap-2">
                  {canOpenUserFields && (
                    <Button asChild variant="outline" size="md">
                      <Link
                        href={ROUTES.USERS_FIELDS}
                        className="flex items-center gap-1"
                      >
                        <List className="h-4 w-4" />
                        <span>Fields</span>
                      </Link>
                    </Button>
                  )}
                  <Link href={ROUTES.USERS_CREATE}>
                    <Button size="md" className="flex items-center gap-1">
                      <Plus className="h-4 w-4" />
                      <span>Create User</span>
                    </Button>
                  </Link>
                </div>
              </>
            }
          />

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
