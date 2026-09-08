"use client";

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

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import type React from "react";
import { useMemo } from "react";

import {
  EntryForm,
  type EntryFormCollection,
} from "@admin/components/features/entries/EntryForm";
import {
  CONTENT_MEASURE_LENGTH,
  CONTENT_PAGE_MEASURE,
} from "@admin/components/layout/content-measure";
import { MeasuredPageFrame } from "@admin/components/layout/MeasuredPageFrame";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
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
function CreateEntryBreadcrumbs({
  collectionSlug,
  collectionLabel,
}: {
  collectionSlug: string;
  collectionLabel: string;
}) {
  return (
    <Breadcrumbs
      items={[
        { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
        {
          label: collectionLabel,
          href: buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: collectionSlug }),
        },
        { label: "Create New Entry" },
      ]}
    />
  );
}

/**
 * Loading skeleton for the create entry page.
 */
function CreateEntryPageSkeleton() {
  return (
    <PageContainer width="full">
      {/* Accessibility: Announce loading state to screen readers */}
      <div className="sr-only" role="status" aria-live="polite">
        Loading collection...
      </div>

      {/* Cancels the page's vertical inset only.
          The horizontal half would pull this skeleton past the measured
          column, and the editor that replaces it would then jump 64px
          narrower. */}
      <div className="flex flex-col lg:flex-row lg:min-h-[calc(100vh-4rem)] items-stretch lg:-my-8">
        {/* Main Content */}
        {/* `min-w-0` as the editor that replaces this carries it: without it
            this pane will not shrink and pushes the rail past the column. */}
        <div
          className="flex-1 min-w-0 space-y-6 lg:p-8 pt-6 mx-auto w-full"
          // The form that replaces this bounds its FIELD column, not the
          // page, so a skeleton bounded at the page moves every field
          // sideways the moment data arrives.
          style={{ maxWidth: CONTENT_MEASURE_LENGTH }}
        >
          {/* Breadcrumbs skeleton */}
          <div className="mb-6">
            <Skeleton className="h-5 w-64" />
          </div>

          {/* Header skeleton */}
          <div className="mb-8">
            <Skeleton className="w-48 mb-2" />
            <Skeleton className="h-5 w-96" />
          </div>

          <div className="bg-card  border border-border rounded-lg p-6">
            <div className="space-y-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          </div>
        </div>

        {/* Sidebar */}
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

  /**
   * The page's measure, on every branch.
   *
   * `CONTENT_PAGE_MEASURE` rather than a literal, and not the settings measure:
   * an entry is a document rather than a short column of labelled controls, and
   * it shares its column with the document rail. These early-return branches
   * never reach `MeasuredPageFrame`, so they read the same constant it does
   * rather than restating a width that could disagree with it.
   *
   * Every branch carries it — loading, each error state, and the editor —
   * because they are the SAME page at different moments. Measuring only the
   * editor would leave the skeleton full-width and reflow the page the instant
   * data arrived, which reads as the layout breaking rather than as content
   * appearing.
   */

  // Missing slug error state
  if (!slug) {
    return (
      <PageContainer width={CONTENT_PAGE_MEASURE}>
        <Alert variant="destructive">
          <AlertDescription>
            No collection was specified in the URL.
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.BUILDER_COLLECTIONS}>
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
      <PageContainer width={CONTENT_PAGE_MEASURE}>
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load collection:{" "}
            {error instanceof Error ? error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.BUILDER_COLLECTIONS}>
            <Button variant="outline">← Back to Collections</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  // Collection not found
  if (!collection) {
    return (
      <PageContainer width={CONTENT_PAGE_MEASURE}>
        <Alert variant="destructive">
          <AlertDescription>
            Collection &quot;{slug}&quot; not found.
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.BUILDER_COLLECTIONS}>
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
        <MeasuredPageFrame
          breadcrumbs={
            <CreateEntryBreadcrumbs
              collectionSlug={slug}
              collectionLabel={collectionLabel}
            />
          }
        >
          {/* Boxed for the same reason the injection slots are: under the
              measured frame this is a direct child of a CSS grid, and the rule
              that puts a child in the content column can only place a
              generated element box. A view rooted in bare text, or in an
              element with `display: contents`, produces none and is
              auto-placed into a gutter. The registry imposes no root-element
              contract, so the page provides the box. */}
          <div>
            <CustomEditView {...customViewProps} />
          </div>
        </MeasuredPageFrame>
      </QueryErrorBoundary>
    );
  }

  // Default: render the EntryForm directly. Breadcrumbs were removed from
  // form, not the header chrome.
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <MeasuredPageFrame contentCarriesMeasure>
        <EntryForm
          collection={collection as unknown as EntryFormCollection}
          mode="create"
          onSuccess={handleSuccess}
          onCancel={handleCancel}
        />
      </MeasuredPageFrame>
    </QueryErrorBoundary>
  );
}
