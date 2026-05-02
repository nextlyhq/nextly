/**
 * Components List Page
 *
 * Displays all Components (code-first and UI-created) in a unified view.
 * Provides component management capabilities including:
 * - Creating new components via the Visual Component Builder
 * - Viewing component metadata (source, migration status, field count, category)
 * - Editing and deleting components
 * - Filtering by source and migration status
 * - Searching by slug/label
 * - Bulk delete operations
 */

import { Button } from "@revnixhq/ui";
import type React from "react";

import * as Icons from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

import ComponentTablePage from "./components/ComponentTable";

/**
 * Components List Page
 */
const ComponentsPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        {/* Breadcrumbs */}
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
            { label: "Components" },
          ]}
          className="mb-8"
        />

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Components
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Manage reusable field groups for your collections and singles
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={ROUTES.COMPONENTS_BUILDER} className="w-full sm:w-auto">
              <Button
                size="sm"
                className="w-full sm:w-auto flex items-center gap-1.5 h-9 sm:h-8"
              >
                <Icons.Plus className="h-4 w-4" />
                <span>New Component</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Component table */}
        <ComponentTablePage />
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default ComponentsPage;
