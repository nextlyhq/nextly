/**
 * Collection API Playground Page
 *
 * Interactive API testing interface for collection endpoints.
 * Accessible via /admin/collections/[slug]/api
 *
 * @module pages/dashboard/entries/[slug]/api
 * @since 1.0.0
 */

import { Alert, AlertDescription, AlertTitle, Skeleton } from "@nextlyhq/ui";

import { APIPlayground } from "@admin/components/features/entries/APIPlayground";
import { AlertCircle } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { useCollection } from "@admin/hooks/queries";

// ============================================================================
// Types
// ============================================================================

interface APIPlaygroundPageProps {
  params?: {
    slug?: string;
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * APIPlaygroundPage - Collection API testing interface
 *
 * Provides a Postman-like interface for testing collection API endpoints
 * with automatic collection context from the URL slug.
 */
export default function APIPlaygroundPage({ params }: APIPlaygroundPageProps) {
  const slug = params?.slug;

  // Fetch collection data
  const {
    data: collection,
    isLoading,
    error,
  } = useCollection(slug ?? "", {
    enabled: !!slug,
  });

  // Handle missing slug
  if (!slug) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Collection slug is required. Please navigate to a collection first.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        {/* Breadcrumb skeleton */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-32" />
        </div>

        {/* Header skeleton */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>

        {/* Content skeleton */}
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-[500px]" />
          <Skeleton className="h-[500px]" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Failed to load collection: {error.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Collection label for display
  const collectionLabel = collection?.label || slug;

  return (
    // Fills the content panel instead of growing past it, so the request and
    // response panes scroll on their own. Otherwise a long response stretches
    // the page and takes the response's own status line off-screen with it.
    <PageContainer className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Page header */}
      <div className="mb-8 shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          API Playground
        </h1>
        {/* Muted foreground so this secondary subtitle meets contrast (a faint primary alpha did not). */}
        <p className="text-sm font-normal text-muted-foreground mt-1">
          Test API endpoints for the <strong>{collectionLabel}</strong>{" "}
          collection. Build requests, execute them, and view responses.
        </p>
      </div>

      {/* API Playground component */}
      <div className="min-h-0 flex-1">
        <APIPlayground
          collectionSlug={slug}
          fields={collection?.fields}
          hasStatus={collection?.status === true}
        />
      </div>
    </PageContainer>
  );
}
