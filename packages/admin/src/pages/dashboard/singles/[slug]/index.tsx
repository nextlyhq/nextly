/**
 * Single Edit Page
 *
 * Page component for editing Single (Global) documents.
 * Unlike collection entries, Singles don't have a list view -
 * this page renders directly as the edit form.
 *
 * Features:
 * - Fetches Single schema and document data
 * - Renders SingleForm with all field types
 * - Auto-save and draft recovery
 * - Unsaved changes protection
 * - Toast notifications on save
 *
 * @module pages/dashboard/singles/[slug]
 * @since 1.0.0
 */

import { Alert, AlertDescription, Button, Skeleton } from "@revnixhq/ui";
import React from "react";

import {
  SingleForm,
  type SingleSchema,
  type SingleDocumentData,
} from "@admin/components/features/singles";
import { ChevronRight, Home, Code } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useSingleDocument,
  useSingleSchema,
  useUpdateSingleDocument,
} from "@admin/hooks/queries/useSingles";
import { navigateTo } from "@admin/lib/navigation";

// ============================================================================
// Types
// ============================================================================

interface SingleEditPageProps {
  params?: { slug?: string };
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Breadcrumb navigation for the Single edit page.
 */
function SingleBreadcrumbs({ singleLabel }: { singleLabel: string }) {
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
        <li className="flex items-center gap-2 text-muted-foreground">
          Singles
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
        </li>
        <li className="text-foreground font-medium">{singleLabel}</li>
      </ol>
    </nav>
  );
}

/**
 * Loading skeleton for the Single edit page.
 */
function SingleEditPageSkeleton() {
  return (
    <PageContainer>
      {/* Accessibility: Announce loading state to screen readers */}
      <div className="sr-only" role="status" aria-live="polite">
        Loading...
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
            <Skeleton className="h-10 w-48 mb-2" />
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
// Component
// ============================================================================

/**
 * Single Edit Page
 *
 * Displays a form for editing a Single (Global) document.
 * The form fields are dynamically generated based on the Single schema.
 *
 * Unlike collection entry pages, Singles:
 * - Go directly to edit form (no list view)
 * - Cannot be deleted
 * - Auto-create if accessed before any data exists
 *
 * @param props - Page props with route params
 * @returns Single edit page component
 */
export default function SingleEditPage({
  params,
}: SingleEditPageProps): React.ReactElement {
  const slug = params?.slug;

  // Fetch Single schema (field definitions)
  const {
    data: schema,
    isLoading: isLoadingSchema,
    error: schemaError,
  } = useSingleSchema(slug);

  // Fetch Single document data
  const {
    data: document,
    isLoading: isLoadingDocument,
    error: documentError,
  } = useSingleDocument(slug);

  // Update mutation
  const { mutateAsync: updateDocument, isPending: isUpdating } =
    useUpdateSingleDocument(slug || "");

  const isLoading = isLoadingSchema || isLoadingDocument;
  const error = schemaError || documentError;

  // Missing slug error state
  if (!slug) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>
            No Single was specified in the URL.
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.SINGLES}>
            <Button variant="outline">← Back to Singles</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  // Loading state
  if (isLoading) {
    return <SingleEditPageSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load Single:{" "}
            {error instanceof Error ? error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.SINGLES}>
            <Button variant="outline">← Back to Singles</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  // Schema not found
  if (!schema) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>
            Single &quot;{slug}&quot; not found.
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.SINGLES}>
            <Button variant="outline">← Back to Singles</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  // Document not found (should auto-create, but handle edge case)
  if (!document) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load document data for Single &quot;{slug}&quot;.
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Link href={ROUTES.SINGLES}>
            <Button variant="outline">← Back to Singles</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  const singleLabel = schema.label || slug;

  // Handle form submission
  const handleSubmit = async (data: Record<string, unknown>) => {
    try {
      await updateDocument(data);
      toast.success(`${singleLabel} has been updated successfully.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save changes"
      );
      throw err; // Re-throw to prevent form from marking as clean
    }
  };

  // Handle cancel - navigate back to Singles list
  const handleCancel = () => {
    navigateTo(ROUTES.SINGLES);
  };

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SingleForm
          schema={schema as unknown as SingleSchema}
          document={document as unknown as SingleDocumentData}
          onSubmit={handleSubmit}
          isSubmitting={isUpdating}
          onCancel={handleCancel}
          headerContent={<SingleBreadcrumbs singleLabel={singleLabel} />}
          headerActions={
            <Button
              variant="outline"
              onClick={() =>
                navigateTo(buildRoute(ROUTES.SINGLE_API, { slug }))
              }
              className="flex-1 sm:flex-initial"
            >
              <Code className="mr-2 h-4 w-4" />
              API
            </Button>
          }
        />
      </PageContainer>
    </QueryErrorBoundary>
  );
}
