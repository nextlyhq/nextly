/**
 * Field Groups List Page
 *
 * Displays all field groups (code-first and UI-created) in a unified view.
 * Provides field group management capabilities including:
 * - Creating new field groups via the Visual Field Group Builder
 * - Viewing field group metadata (source, migration status, field count, category)
 * - Editing and deleting field groups
 * - Filtering by source and migration status
 * - Searching by slug/label
 * - Bulk delete operations
 */

import { Button, PageHeader } from "@nextlyhq/ui";
import type React from "react";

import * as Icons from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

import FieldGroupTablePage from "./components/FieldGroupTable";

/**
 * Field Groups List Page
 */
const FieldGroupsPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        {/* Breadcrumbs */}
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
            { label: "Field Groups" },
          ]}
          className="mb-6"
        />

        {/* Page header */}
        <PageHeader
          title="Field Groups"
          description="Manage reusable field groups for your collections and singles"
          actions={
            <>
              <div className="flex items-center gap-2">
                <Link
                  href={ROUTES.BUILDER_FIELD_GROUPS_NEW}
                  className="w-full sm:w-auto"
                >
                  <Button size="md">
                    <Icons.Plus className="h-4 w-4" />
                    <span>New Field Group</span>
                  </Button>
                </Link>
              </div>
            </>
          }
        />

        {/* Field group table */}
        <FieldGroupTablePage />
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default FieldGroupsPage;
