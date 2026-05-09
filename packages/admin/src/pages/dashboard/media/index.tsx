"use client";

/**
 * Media Library Page
 *
 * Main page for the Media Library feature.
 * Renders the full MediaLibrary component with folder support,
 * upload, search, filtering, bulk operations, and media management.
 */

import { MediaLibrary } from "@admin/components/features/media-library";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";

/**
 * MediaLibraryPage component
 */
export default function MediaLibraryPage() {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer className="overflow-hidden">
        {/* MediaLibrary component handles its own header, sidebar, and content */}
        <MediaLibrary />
      </PageContainer>
    </QueryErrorBoundary>
  );
}
