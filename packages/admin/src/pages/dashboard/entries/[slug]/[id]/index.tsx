"use client";

/**
 * Edit Entry Page
 *
 * Page component for editing existing entries in a collection.
 * Uses the collection schema to render the appropriate form fields
 * via the EntryForm component, pre-populated with existing entry data.
 *
 * @module pages/dashboard/entries/[slug]/[id]
 * @since 1.0.0
 */

import { Alert, AlertDescription, Button, Skeleton } from "@revnixhq/ui";
import type React from "react";
import { useMemo } from "react";

import {
  EntryForm,
  type EntryFormCollection,
} from "@admin/components/features/entries/EntryForm";
import { ChevronRight, Home } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useCollectionSchema } from "@admin/hooks/queries/useCollections";
import { useEntry } from "@admin/hooks/queries/useEntry";
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
 * Props for the EditEntryPage component.
 * Params are injected by the routing system.
 */
interface EditEntryPageProps {
  params?: { slug?: string; id?: string };
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Breadcrumb navigation for the edit entry page.
 */
function EntryBreadcrumbs({
  collectionSlug,
  collectionLabel,
  entryTitle,
}: {
  collectionSlug: string;
  collectionLabel: string;
  entryTitle: string;
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
        <li className="text-foreground font-medium">{entryTitle}</li>
      </ol>
    </nav>
  );
}

/**
 * Loading skeleton for the edit entry page.
 */
function EditEntryPageSkeleton() {
  return (
    <PageContainer>
      {/* Accessibility: Announce loading state to screen readers */}
      <div className="sr-only" role="status" aria-live="polite">
        Loading entry...
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

              {/* Document Info Skeleton */}
              <div className="pt-6 border-t border-border">
                <div className="bg-primary/5 px-6 py-3 mb-4">
                  <Skeleton className="h-4 w-32" />
                </div>
                <div className="px-6 space-y-4">
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
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
// Helpers
// ============================================================================

/**
 * Extract a display title from entry data.
 * Tries common title fields: title, name, label, subject, then falls back to ID.
 */
function getEntryTitle(
  entry: Record<string, unknown>,
  id: string,
  useAsTitle?: string
): string {
  // 1. Try designated title field
  if (useAsTitle && useAsTitle !== "id") {
    const value = entry[useAsTitle];
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    if (value !== undefined && value !== null && String(value).trim()) {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(value);
    }
  }

  // 2. Try common title fields
  const titleFields = ["title", "name", "label", "subject", "heading"];

  for (const field of titleFields) {
    const value = entry[field];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  // 3. Fallback to shortened ID
  return `Entry ${id.substring(0, 8)}...`;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Edit Entry Page
 *
 * Displays a form for editing an existing entry in a collection.
 * The form fields are dynamically generated based on the collection schema
 * and pre-populated with the entry's current data.
 *
 * @param props - Page props with route params
 * @returns Edit entry page component
 */
export default function EditEntryPage({
  params,
}: EditEntryPageProps): React.ReactElement {
  const slug = params?.slug;
  const id = params?.id;

  // Fetch enriched collection schema (component fields are populated)
  const {
    data: collection,
    isLoading: isLoadingCollection,
    error: collectionError,
  } = useCollectionSchema(slug);

  // Fetch entry data with relationship expansion
  // depth: 2 ensures relationship fields include display labels (title, name, etc.)
  const {
    data: entry,
    isLoading: isLoadingEntry,
    error: entryError,
  } = useEntry({
    collectionSlug: slug || "",
    entryId: id,
    depth: 2,
  });

  // Auto-register plugin components when collection is loaded
  // Auto-register plugin components when collection is loaded
  // This ensures custom Edit view components are available before rendering
  const collectionsForRegistration = useMemo(
    () => (collection ? [collection as unknown as ApiCollection] : undefined),
    [collection]
  );
  usePluginAutoRegistration(collectionsForRegistration);

  const isLoading = isLoadingCollection || isLoadingEntry;
  const error = collectionError || entryError;

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

  // Missing ID error state
  if (!id) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>
            No entry ID was specified in the URL.
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={buildRoute(ROUTES.COLLECTION_ENTRIES, { slug })}>
            <Button variant="outline">← Back to {slug}</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  // Loading state
  if (isLoading) {
    return <EditEntryPageSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load entry:{" "}
            {error instanceof Error ? error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={buildRoute(ROUTES.COLLECTION_ENTRIES, { slug })}>
            <Button variant="outline">← Back to {slug}</Button>
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

  // Entry not found
  if (!entry) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>
            Entry &quot;{id}&quot; not found in collection &quot;{slug}&quot;.
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={buildRoute(ROUTES.COLLECTION_ENTRIES, { slug })}>
            <Button variant="outline">
              ← Back to {collection.label || slug}
            </Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  const collectionLabel = collection.label || collection.name || slug;
  // Cast entry to Record<string, unknown> for getEntryTitle helper
  const entryData = entry as unknown as Record<string, unknown>;
  const entryTitle = getEntryTitle(
    entryData,
    id,
    collection.admin?.useAsTitle
  );

  // Check for custom Edit view component from plugins
  const customEditViewPath =
    collection.admin?.components?.views?.Edit?.Component;
  const CustomEditView = customEditViewPath
    ? getComponent<CustomEditViewProps>(customEditViewPath)
    : undefined;

  // Shared callbacks for both default and custom views
  const handleSuccess = () => {
    // Stay on edit page - success toast is shown by mutation hook
  };

  const handleDelete = () => {
    // Navigate back to entry list after deletion
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
      entryId: id,
      isCreating: false,
      initialData: entryData,
      onSuccess: handleSuccess,
      onDelete: handleDelete,
      onCancel: handleCancel,
    };

    return (
      <QueryErrorBoundary fallback={<PageErrorFallback />}>
        <PageContainer>
          <EntryBreadcrumbs
            collectionSlug={slug}
            collectionLabel={collectionLabel}
            entryTitle={entryTitle}
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
        {/* Entry Form */}
        <EntryForm
          collection={collection as unknown as EntryFormCollection}
          entry={entry}
          mode="edit"
          onSuccess={handleSuccess}
          onDelete={handleDelete}
          onCancel={handleCancel}
          headerContent={
            <EntryBreadcrumbs
              collectionSlug={slug}
              collectionLabel={collectionLabel}
              entryTitle={entryTitle}
            />
          }
        />
      </PageContainer>
    </QueryErrorBoundary>
  );
}
