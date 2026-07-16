/**
 * Plugins List Page
 *
 * Displays all installed plugins in a unified view: name with description and
 * author, installed version, category, and enabled state, with search and a
 * status filter. Rows navigate to each plugin's detail page. Installing,
 * updating, and removing plugins happen through npm + the Nextly config, so
 * this page reports state rather than mutating it.
 *
 * @module pages/dashboard/plugins
 */

import type React from "react";
import { Suspense } from "react";

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
              The plugins installed in your application, what each one adds, and
              whether it is enabled.
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
