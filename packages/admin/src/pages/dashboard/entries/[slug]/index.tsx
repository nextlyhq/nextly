/**
 * Collection Entries Page
 *
 * Displays entries for a specific collection with pagination, search,
 * sorting, and bulk operations.
 *
 * @module pages/dashboard/entries/[slug]
 * @since 1.0.0
 */

import React from "react";

import { EntryList } from "@admin/components/features/entries/EntryList";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the CollectionEntriesPage component.
 * Params are injected by the routing system.
 */
interface CollectionEntriesPageProps {
  params?: { slug?: string };
}

// ============================================================================
// Component
// ============================================================================

/**
 * Collection Entries Page
 *
 * Displays the entry list for a specific collection.
 * Handles missing slug error state.
 *
 * @param props - Page props with route params
 * @returns Collection entries page component
 */
export default function CollectionEntriesPage({
  params,
}: CollectionEntriesPageProps): React.ReactElement {
  const slug = params?.slug;

  // Missing slug error state
  if (!slug) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center py-16">
          <h2 className="text-lg font-semibold mb-2">Collection Not Found</h2>
          <p className="text-muted-foreground">
            No collection was specified in the URL.
          </p>
        </div>
      </PageContainer>
    );
  }

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <EntryList collectionSlug={slug} />
      </PageContainer>
    </QueryErrorBoundary>
  );
}
