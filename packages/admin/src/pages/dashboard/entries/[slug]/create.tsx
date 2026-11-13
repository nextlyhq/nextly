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

import { Alert, AlertDescription, Button } from "@nextlyhq/ui";
import type React from "react";
import { useEffect, useState } from "react";

import {
  EntryForm,
  UnsavedChangesGuard,
  type EntryFormCollection,
} from "@admin/components/features/entries/EntryForm";
import { DOCUMENT_COLUMN_INSET } from "@admin/components/features/entries/EntryForm/DocumentEditorLayout";
import {
  UnsavedWorkProvider,
  useUnsavedWork,
} from "@admin/components/features/entries/EntryForm/UnsavedWorkContext";
import { isRemovedFromCode } from "@admin/components/features/entries/removed-from-code-notice";
import { RemovedFromCodeNotice } from "@admin/components/features/entries/RemovedFromCodeNotice";
import {
  CONTENT_MEASURE_LENGTH,
  CONTENT_PAGE_MEASURE,
} from "@admin/components/layout/content-measure";
import { MeasuredPageFrame } from "@admin/components/layout/MeasuredPageFrame";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { EditorOutline } from "@admin/components/shared/loading-frame/outlines";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useCollectionSchema } from "@admin/hooks/queries/useCollections";
import { navigateTo } from "@admin/lib/navigation";
import {
  getComponent,
  type CustomEditViewProps,
} from "@admin/lib/plugins/component-registry";
import { editViewHasPages } from "@admin/lib/plugins/document-view-registry";
import { getCollectionFields } from "@admin/types/collection";

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
  // The editor's outline, the one the frame drew for this address while the
  // session was checked: the bar's controls at once, then the fields and the
  // side panel at the editor's own geometry.
  return (
    <EditorOutline
      // A new entry's bar has only its verbs.
      creating
      sideWidth={320}
      columnClassName={DOCUMENT_COLUMN_INSET}
      columnStyle={{ maxWidth: CONTENT_MEASURE_LENGTH }}
    />
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

  /*
   * What a custom edit view says it holds unsaved, as on the edit page: the
   * view replaces the form, so this page guards leaving for it. Hooks, so
   * above the returns below.
   */
  const customViewUnsaved = useUnsavedWork();
  /*
   * The document a custom editor with pages of its own just created. Its
   * editor carries on at the new document's own address. Moved there on the
   * render AFTER the guard is told to stand down: the view clears its unsaved
   * work as it reports success, but the guard only hears that on its next
   * render, and a move made in the same breath would be asked about.
   */
  const [createdId, setCreatedId] = useState<string>();
  useEffect(() => {
    if (createdId === undefined || slug === undefined) return;
    navigateTo(
      buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, { slug, id: createdId })
    );
  }, [createdId, slug]);

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
  // The trail's step leads to the collection's list, so it says what the
  // list and the default editor's trail say: the plural ("Submissions"),
  // not the one-entry label a collection may also answer as `label`.
  const listLabel = collection.labels?.plural || collectionLabel;

  // A collection removed from code refuses every create, so no form is
  // offered: the notice says why and what to do, with the way back to its
  // entries, which can still be read.
  if (isRemovedFromCode(collection)) {
    return (
      <PageContainer width={CONTENT_PAGE_MEASURE}>
        <RemovedFromCodeNotice
          entity={{ kind: "collection", label: collectionLabel, slug }}
          state={collection.removedFromCodeState}
        />
        <div className="mt-6">
          <Link href={buildRoute(ROUTES.COLLECTION_ENTRIES, { slug })}>
            <Button variant="outline">← Back to {collectionLabel}</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  // Check for custom Edit view component from plugins
  // The same Edit view handles both create and edit modes
  const customEditViewPath =
    collection.admin?.components?.views?.Edit?.Component;
  const CustomEditView = customEditViewPath
    ? getComponent<CustomEditViewProps>(customEditViewPath)
    : undefined;

  // A custom edit view with pages of its own is a whole editor, which carries
  // on at the document it created; any other view returns to the list.
  const customViewHasPages = editViewHasPages(slug, customEditViewPath);

  // Shared callbacks
  const handleSuccess = (entry?: Record<string, unknown>) => {
    const id = entry?.id;
    if (customViewHasPages && typeof id === "string" && id !== "") {
      setCreatedId(id);
      return;
    }
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
          contentCarriesMeasure={customViewHasPages}
          breadcrumbs={
            <CreateEntryBreadcrumbs
              collectionSlug={slug}
              collectionLabel={listLabel}
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
            {/* The view reports its unsaved work here, and leaving asks first
                while it holds any. */}
            <UnsavedWorkProvider report={customViewUnsaved.report}>
              <UnsavedChangesGuard
                isDirty={customViewUnsaved.anyUnsaved}
                disabled={createdId !== undefined}
                fields={getCollectionFields(collection)}
              >
                <CustomEditView {...customViewProps} />
              </UnsavedChangesGuard>
            </UnsavedWorkProvider>
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
