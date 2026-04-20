/**
 * Plugins List Page
 *
 * Displays all installed plugins in a unified view.
 * Provides plugin management capabilities including:
 * - Viewing installed plugins (name, version, placement)
 * - Filtering and search
 * - Column management
 * - Multi-select bulk actions
 *
 * @module pages/dashboard/plugins
 */

import React, { Suspense } from "react";

import * as Icons from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

import PluginsTable from "./components/PluginsTable";
import { PluginsTableSkeleton } from "./components/PluginsTableSkeleton";

/**
 * Plugins Overview Page
 *
 * Main page for viewing and managing installed plugins.
 */
const PluginsOverviewPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="mb-8">
          <ol className="flex items-center gap-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <Link
                href={ROUTES.DASHBOARD}
                className="flex items-center gap-1 hover-unified"
              >
                <Icons.Home className="h-4 w-4" />
                <span>Dashboard</span>
              </Link>
              <Icons.ChevronRight className="h-4 w-4 text-muted-foreground/50" />
            </li>
            <li className="text-foreground font-medium">Plugins</li>
          </ol>
        </nav>

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Installed Plugins
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              View and manage the plugins currently installed in your
              application.
            </p>
          </div>
        </div>

        {/* Plugins table */}
        <Suspense fallback={<PluginsTableSkeleton />}>
          <PluginsTable />
        </Suspense>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default PluginsOverviewPage;
