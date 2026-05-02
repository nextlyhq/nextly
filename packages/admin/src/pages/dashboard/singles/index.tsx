/**
 * Singles List Page
 *
 * Displays all Singles (code-first, UI-created, and built-in) in a unified view.
 * Provides Single management capabilities including:
 * - Creating new Singles via the Visual Single Builder
 * - Viewing Single metadata (source, migration status, field count)
 * - Editing schema (UI Singles only), editing documents, and deleting Singles
 * - Filtering by source and migration status
 * - Searching by label/slug
 *
 * Singles are single-document entities
 * for storing site-wide configuration such as site settings, navigation menus,
 * footers, and homepage configurations.
 *
 * @module pages/dashboard/singles
 */

import { Button } from "@revnixhq/ui";
import type React from "react";

import { Plus } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

import SinglesTable from "./components/SinglesTable";

/**
 * Singles List Page Component
 *
 * Main page for viewing and managing Singles (Globals).
 */
const SinglesPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        {/* Breadcrumbs */}
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
            { label: "Singles" },
          ]}
          className="mb-8"
        />

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Singles
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Manage site-wide settings and global configurations
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={ROUTES.SINGLES_BUILDER} className="w-full sm:w-auto">
              <Button
                size="sm"
                className="w-full sm:w-auto flex items-center gap-1.5 h-9 sm:h-8"
              >
                <Plus className="h-4 w-4" />
                <span>New Single</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Singles table */}
        <SinglesTable />
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default SinglesPage;
