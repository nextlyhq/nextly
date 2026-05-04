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

import { Alert, AlertDescription, AlertTitle } from "@revnixhq/ui";
import type React from "react";
import { Suspense } from "react";

import { Info } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
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
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
            { label: "Plugins" },
          ]}
          className="mb-6"
        />

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Installed Plugins
            </h1>
            <p className="text-sm font-normal text-primary/50 mt-1">
              View and manage the plugins currently installed in your
              application.
            </p>
          </div>
        </div>

        {/* In-development banner */}
        <Alert variant="info" role="status" className="mb-6">
          <Info className="h-4 w-4" />
          <div>
            <AlertTitle>Plugins are in development</AlertTitle>
            <AlertDescription>
              Plugin installation and management is coming soon. The current
              view is a preview &mdash; some features may not be fully
              functional.
            </AlertDescription>
          </div>
        </Alert>

        {/* Plugins table */}
        <Suspense fallback={<PluginsTableSkeleton />}>
          <PluginsTable />
        </Suspense>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default PluginsOverviewPage;
