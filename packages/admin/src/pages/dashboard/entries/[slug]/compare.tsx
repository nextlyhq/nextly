/**
 * Entry Compare Page
 *
 * Side-by-side comparison view for two entries from the same collection.
 * Accessible via /admin/collection/[slug]/compare
 *
 * @module pages/dashboard/entries/[slug]/compare
 * @since 1.0.0
 */

import { Alert, AlertDescription, AlertTitle, Skeleton } from "@revnixhq/ui";

import { EntryCompare } from "@admin/components/features/entries/EntryCompare";
import { AlertCircle, ArrowLeftRight } from "@admin/components/icons";
import { Breadcrumbs } from "@admin/components/shared";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useCollection } from "@admin/hooks/queries";

// ============================================================================
// Types
// ============================================================================

interface ComparePageProps {
  params?: {
    slug?: string;
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * CompareEntryPage - Entry comparison interface
 *
 * Provides a side-by-side comparison view for two entries from the same
 * collection with field-level diff highlighting.
 */
export default function CompareEntryPage({ params }: ComparePageProps) {
  const slug = params?.slug;

  // Fetch collection data (useCollection only takes collectionName, auto-disables when empty)
  const { data: collection, isLoading, error } = useCollection(slug ?? "");

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
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-6 w-6" />
            <Skeleton className="h-10 flex-1" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
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
    <div className="p-6 space-y-6 h-full flex flex-col">
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
            {
              label: collectionLabel,
              href: buildRoute(ROUTES.COLLECTION_ENTRIES, { slug }),
            },
            { label: "Compare Entries" },
          ]}
        />
      </div>

      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <ArrowLeftRight className="h-6 w-6 text-muted-foreground/70" />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Compare Entries</h1>
        </div>
        <p className="text-sm font-normal text-primary/50 mt-1">
          Compare two entries from the <strong>{collectionLabel}</strong>{" "}
          collection side-by-side to see their differences.
        </p>
      </div>

      {/* Entry Compare component */}
      <div className="flex-1 min-h-0">
        <EntryCompare collectionSlug={slug} />
      </div>
    </div>
  );
}
