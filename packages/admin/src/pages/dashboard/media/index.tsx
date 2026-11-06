"use client";

/**
 * Media Library Page
 *
 * Main page for the Media Library feature.
 * Renders the full MediaLibrary component with folder support,
 * upload, search, filtering, bulk operations, and media management.
 */

import type { JSX } from "react";

import { MediaLibrary } from "@admin/components/features/media-library";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";

/**
 * MediaLibraryPage component
 */
export default function MediaLibraryPage(): JSX.Element {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      {/* Clipped sideways rather than `overflow-hidden`: hidden overflow makes
          the container a scroll box of its own, and the details panel would
          then stick to it instead of to the page's scrolling area. */}
      <PageContainer className="overflow-x-clip">
        {/* MediaLibrary component handles its own header, sidebar, and content */}
        <MediaLibrary />
      </PageContainer>
    </QueryErrorBoundary>
  );
}
