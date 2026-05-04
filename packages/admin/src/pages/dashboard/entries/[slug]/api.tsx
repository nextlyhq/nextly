/**
 * Collection API Playground Page
 *
 * Interactive API testing interface for collection endpoints.
 * Accessible via /admin/collection/[slug]/api
 *
 * @module pages/dashboard/entries/[slug]/api
 * @since 1.0.0
 */

import { Alert, AlertDescription, AlertTitle, Skeleton } from "@revnixhq/ui";

import { APIPlayground } from "@admin/components/features/entries/APIPlayground";
import { DocumentTabs } from "@admin/components/features/entries/DocumentTabs";
import { AlertCircle } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { ROUTES, buildRoute } from "@admin/constants/routes";
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
    <PageContainer>
      <div className="flex flex-col gap-4 h-full">
        <div className="mb-6">
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
              {
                label: collectionLabel,
                href: buildRoute(ROUTES.COLLECTION_ENTRIES, { slug }),
              },
              { label: "API Playground" },
            ]}
          />
        </div>

        {/* Document tabs (Q-D6=c) — same strip as on the Edit page so users feel
            they're still on the same document. */}
        <DocumentTabs scope="collection" slug={slug} />

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            API Playground
          </h1>
          <p className="text-sm font-normal text-primary/50 mt-1">
            Test API endpoints for the <strong>{collectionLabel}</strong>{" "}
            collection. Build requests, execute them, and view responses.
          </p>
        </div>

        {/* API Playground component */}
        <div className="flex-1 min-h-0">
          <APIPlayground collectionSlug={slug} />
        </div>
      </div>
    </PageContainer>
  );
}
