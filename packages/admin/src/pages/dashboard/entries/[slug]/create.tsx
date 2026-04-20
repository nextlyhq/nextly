/**
 * Create Entry Page
 *
 * Page component for creating new entries in a collection.
 * Uses the collection schema to render the appropriate form fields
 * via the EntryForm component.
 *
 * @module pages/dashboard/entries/[slug]/create
 * @since 1.0.0
 */

import { Alert, AlertDescription, Button, Skeleton } from "@revnixhq/ui";
import React, { useMemo } from "react";

import {
  EntryForm,
  type EntryFormCollection,
  type EntryData,
} from "@admin/components/features/entries/EntryForm";
import { ChevronRight, Home, Loader2 } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useCollectionSchema } from "@admin/hooks/queries/useCollections";
import { usePluginAutoRegistration } from "@admin/hooks/usePluginAutoRegistration";
import { navigateTo } from "@admin/lib/navigation";
import {
  getComponent,
  type CustomEditViewProps,
} from "@admin/lib/plugins/component-registry";
import type { ApiCollection } from "@admin/types/entities";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the CreateEntryPage component.
 * Params are injected by the routing system.
 */
interface CreateEntryPageProps {
  params?: { slug?: string };
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Breadcrumb navigation for the create entry page.
 */
function EntryBreadcrumbs({
  collectionSlug,
  collectionLabel,
}: {
  collectionSlug: string;
  collectionLabel: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex items-center gap-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <Link
            href={ROUTES.DASHBOARD}
            className="flex items-center gap-1 hover-unified"
          >
            <Home className="h-4 w-4" />
            <span>Dashboard</span>
          </Link>
          <ChevronRight className="h-4 w-4" />
        </li>
        <li className="flex items-center gap-2">
          <Link
            href={buildRoute(ROUTES.COLLECTION_ENTRIES, {
              slug: collectionSlug,
            })}
            className="hover-unified"
          >
            {collectionLabel}
          </Link>
          <ChevronRight className="h-4 w-4" />
        </li>
        <li className="text-foreground font-medium">Create New</li>
      </ol>
    </nav>
  );
}

/**
 * Loading skeleton for the create entry page.
 */
function CreateEntryPageSkeleton() {
  return (
    <PageContainer>
      {/* Accessibility: Announce loading state to screen readers */}
      <div className="sr-only" role="status" aria-live="polite">
        Loading collection...
      </div>

      <div className="flex flex-col lg:flex-row lg:min-h-[calc(100vh-4rem)] items-stretch lg:-m-8">
        {/* Main Content */}
        <div className="flex-1 space-y-6 lg:p-8 pt-6">
          {/* Breadcrumbs skeleton */}
          <div className="mb-2">
            <Skeleton className="h-5 w-64" />
          </div>

          {/* Header skeleton */}
          <div className="mb-8">
            <Skeleton className="h-9 w-48 mb-2" />
            <Skeleton className="h-5 w-96" />
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="space-y-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-l lg:border-border bg-card flex flex-col relative z-10">
          <div className="lg:sticky lg:top-0 lg:h-[calc(100vh-4rem)] flex flex-col">
            {/* Sidebar Header/Actions Skeleton */}
            <div className="p-6 border-b border-border space-y-3">
              <div className="flex gap-3">
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 flex-1" />
              </div>
            </div>

            {/* Sidebar Content Skeleton */}
            <div className="p-6 space-y-8">
              {/* Sidebar Fields / SEO */}
              <div className="space-y-4">
                <Skeleton className="h-6 w-32" />
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              </div>

              {/* Document Info Skeleton (Empty in Create mode but placeholder header shown) */}
              <div className="pt-6 border-t border-border">
                <div className="bg-primary/5 px-6 py-3 mb-4">
                  <Skeleton className="h-4 w-32" />
                </div>
                <div className="px-6 py-4 text-xs text-muted-foreground italic">
                  Document info will be available after saving.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

// ============================================================================
// Component
// ============================================================================

/**
 * Create Entry Page
 *
 * Displays a form for creating a new entry in a collection.
 * The form fields are dynamically generated based on the collection schema.
 *
 * @param props - Page props with route params
 * @returns Create entry page component
 */
export default function CreateEntryPage({
  params,
}: CreateEntryPageProps): React.ReactElement {
  const slug = params?.slug;

  // Fetch enriched collection schema (component fields are populated)
  const { data: collection, isLoading, error } = useCollectionSchema(slug);

  // Auto-register plugin components when collection is loaded
  // This ensures custom Edit view components are available before rendering
  const collectionsForRegistration = useMemo(
    () => (collection ? [collection as unknown as ApiCollection] : undefined),
    [collection]
  );
  usePluginAutoRegistration(collectionsForRegistration);

  // Missing slug error state
  if (!slug) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>
            No collection was specified in the URL.
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.COLLECTIONS}>
            <Button variant="outline">← Back to Collections</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  // Loading state
  if (isLoading) {
    return <CreateEntryPageSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load collection:{" "}
            {error instanceof Error ? error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.COLLECTIONS}>
            <Button variant="outline">← Back to Collections</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  // Collection not found
  if (!collection) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>
            Collection &quot;{slug}&quot; not found.
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.COLLECTIONS}>
            <Button variant="outline">← Back to Collections</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  const collectionLabel = collection.label || collection.name || slug;

  // Check for custom Edit view component from plugins
  // The same Edit view handles both create and edit modes
  const customEditViewPath =
    collection.admin?.components?.views?.Edit?.Component;
  const CustomEditView = customEditViewPath
    ? getComponent<CustomEditViewProps>(customEditViewPath)
    : undefined;

  // Shared callbacks
  const handleSuccess = () => {
    // Navigate to entry list page after successful creation
    navigateTo(buildRoute(ROUTES.COLLECTION_ENTRIES, { slug }));
  };

  const handleCancel = () => {
    // Navigate back to entry list
    navigateTo(buildRoute(ROUTES.COLLECTION_ENTRIES, { slug }));
  };

  // Render custom Edit view if registered
  if (CustomEditView) {
    const customViewProps: CustomEditViewProps = {
      collectionSlug: slug,
      entryId: undefined, // No ID for create mode
      isCreating: true,
      initialData: undefined,
      onSuccess: handleSuccess,
      onCancel: handleCancel,
    };

    return (
      <QueryErrorBoundary fallback={<PageErrorFallback />}>
        <PageContainer>
          <EntryBreadcrumbs
            collectionSlug={slug}
            collectionLabel={collectionLabel}
          />
          <CustomEditView {...customViewProps} />
        </PageContainer>
      </QueryErrorBoundary>
    );
  }

  // Default: Render standard EntryForm
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        {/* Entry Form - includes its own header via EntryFormHeader */}
        <EntryForm
          collection={collection as unknown as EntryFormCollection}
          mode="create"
          onSuccess={handleSuccess}
          onCancel={handleCancel}
          headerContent={
            <EntryBreadcrumbs
              collectionSlug={slug}
              collectionLabel={collectionLabel}
            />
          }
        />
      </PageContainer>
    </QueryErrorBoundary>
  );
}
