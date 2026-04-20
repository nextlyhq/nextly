/**
 * Single API Playground Page
 *
 * Interactive API testing interface for single endpoints.
 * Accessible via /admin/singles/[slug]/api
 *
 * @module pages/dashboard/singles/[slug]/api
 * @since 1.0.0
 */

import { Alert, AlertDescription, AlertTitle, Skeleton } from "@revnixhq/ui";

import { APIPlayground } from "@admin/components/features/entries/APIPlayground";
import { ChevronRight, Home, AlertCircle, Code } from "@admin/components/icons";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useSingleSchema } from "@admin/hooks/queries";
import { navigateTo } from "@admin/lib/navigation";

// ============================================================================
// Types
// ============================================================================

interface SingleAPIPlaygroundPageProps {
  params?: {
    slug?: string;
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * SingleAPIPlaygroundPage - Single API testing interface
 *
 * Provides a Postman-like interface for testing single API endpoints
 * with automatic single context from the URL slug.
 */
export default function SingleAPIPlaygroundPage({
  params,
}: SingleAPIPlaygroundPageProps) {
  const slug = params?.slug;

  // Fetch single schema data
  const {
    data: schema,
    isLoading,
    error,
  } = useSingleSchema(slug ?? "", {
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
            Single slug is required. Please navigate to a single first.
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
            Failed to load single: {error.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Single label for display
  const singleLabel = schema?.label || slug;

  return (
    <div className="p-6 space-y-6 h-full flex flex-col">
      {/* Breadcrumb navigation */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          onClick={() => navigateTo(ROUTES.DASHBOARD)}
          className="flex items-center gap-1 hover-unified"
        >
          <Home className="h-4 w-4" />
        </button>
        <ChevronRight className="h-4 w-4" />
        <button
          onClick={() => navigateTo(buildRoute(ROUTES.SINGLE_EDIT, { slug }))}
          className="hover-unified"
        >
          {singleLabel}
        </button>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground font-medium">API Playground</span>
      </nav>

      {/* Page header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Code className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-bold tracking-tight">API Playground</h1>
        </div>
        <p className="text-muted-foreground">
          Test API endpoints for the <strong>{singleLabel}</strong> single.
          Build requests, execute them, and view responses.
        </p>
      </div>

      {/* API Playground component */}
      <div className="flex-1 min-h-0">
        <APIPlayground collectionSlug={slug} isSingle={true} />
      </div>
    </div>
  );
}
