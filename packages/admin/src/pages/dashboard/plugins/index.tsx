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

import { Button, PageHeader } from "@nextlyhq/ui";
import type React from "react";
import { Suspense } from "react";

import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
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
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
            { label: "Plugins" },
          ]}
          className="mb-6"
        />

        {/* Page header */}
        <PageHeader
          title="Installed Plugins"
          description="The plugins installed in your application, what each one adds, and whether it is enabled."
          actions={
            <>
              {/* In the header rather than only in the empty state: a project that
              already has plugins is the one most likely to want another, and an
              action that appears only while the list is empty is unreachable
              exactly then. */}
              <Button asChild variant="outline" size="sm">
                <Link href={ROUTES.PLUGIN_BROWSE}>Browse plugins</Link>
              </Button>
            </>
          }
        />

        {/* Plugins table */}
        <Suspense fallback={<PluginsTableSkeleton />}>
          <PluginsTable />
        </Suspense>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default PluginsOverviewPage;
