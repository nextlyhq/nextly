import { Button } from "@revnixhq/ui";
import type React from "react";

import { CollectionBreadcrumbs } from "@admin/components/features/collection-management/breadcrumbs";
import { Plus } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

import CollectionTablePage from "./components/CollectionTable";

/**
 * Collections List Page
 *
 * Displays all collections (code-first, UI-created, and built-in) in a unified view.
 * Provides collection management capabilities including:
 * - Creating new collections via the Visual Collection Builder
 * - Viewing collection metadata (source, migration status, field count)
 * - Editing, viewing entries, and deleting collections
 * - Filtering by source and migration status
 * - Searching by name/slug
 */
const CollectionsPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <div className="mb-6">
          <CollectionBreadcrumbs currentPage="list" />
        </div>

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Collections</h1>
            <p className="text-sm font-normal text-primary/50 mt-1">
              Manage collections and their configuration
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={ROUTES.COLLECTIONS_BUILDER}
              className="w-full sm:w-auto"
            >
              <Button
                size="md"                
              >
                <Plus className="h-4 w-4" />
                <span>New Collection</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Collection table */}
        <CollectionTablePage />
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default CollectionsPage;
