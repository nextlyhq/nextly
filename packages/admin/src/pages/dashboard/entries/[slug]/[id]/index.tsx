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

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import type React from "react";
import { useMemo } from "react";

import { entryTitleValue } from "@admin/components/features/entries/entry-title";
import {
  EntryForm,
  type EntryFormCollection,
} from "@admin/components/features/entries/EntryForm";
import { useAddToReleaseAction } from "@admin/components/features/releases/AddToReleaseAction";
import { ScheduledReleaseBanner } from "@admin/components/features/releases/ScheduledReleaseBanner";
import {
  CONTENT_PAGE_MEASURE,
  CONTENT_MEASURE_LENGTH,
} from "@admin/components/layout/content-measure";
import { MeasuredPageFrame } from "@admin/components/layout/MeasuredPageFrame";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useCollectionSchema } from "@admin/hooks/queries/useCollections";
import { useEntry } from "@admin/hooks/queries/useEntry";
import { useEditorLocale } from "@admin/hooks/useEditorLocale";
import { useLocalization } from "@admin/hooks/useLocalization";
import { usePluginAutoRegistration } from "@admin/hooks/usePluginAutoRegistration";
import { useTranslationMode } from "@admin/hooks/useTranslationMode";
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
function EditEntryBreadcrumbs({
  collectionSlug,
  collectionLabel,
  entryTitle,
}: {
  collectionSlug: string;
  collectionLabel: string;
  entryTitle: string;
}) {
  return (
    <Breadcrumbs
      items={[
        { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
        {
          label: collectionLabel,
          href: buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: collectionSlug }),
        },
        { label: entryTitle },
      ]}
    />
  );
}

/**
 * Loading skeleton for the edit entry page.
 */
function EditEntryPageSkeleton() {
  return (
    <PageContainer width="full">
      {/* Accessibility: Announce loading state to screen readers */}
      <div className="sr-only" role="status" aria-live="polite">
        Loading entry...
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
          // The editor that replaces this bounds its FIELD column, not the
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
        <div className="w-full lg:w-[320px] shrink-0  border-t border-border lg:border-t-0 lg:border-l border-border lg:border-border bg-card flex flex-col relative z-10">
          <div className="lg:sticky lg:top-0 lg:h-[calc(100vh-4rem)] flex flex-col">
            {/* Sidebar Header/Actions Skeleton */}
            <div className="p-6  border-b border-border space-y-3">
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
              <div className="pt-6  border-t border-border">
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
  // The shared order, so this heading and the version comparison's name the
  // same document the same way. Only the last resort is decided here: a
  // heading must produce text, and a shortened id is what identifies an entry
  // that says nothing about itself.
  return entryTitleValue(entry, useAsTitle) ?? `Entry ${id.substring(0, 8)}...`;
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

  // i18n M7: active content language for this editor. `undefined` = the app's default locale
  // (the backend resolves it). Switching triggers a refetch (useEntry is keyed by locale) and
  // routes saves to the chosen language (EntryForm → useUpdateEntry).
  const { locale, changeLocale, resetLocale, seedFromLocale, clearSeed } =
    useEditorLocale();

  // Read here rather than at the branch that uses it: this component returns
  // early for loading and error states, and a hook after those runs
  // conditionally.

  // Fetch enriched collection schema (component fields are populated)
  const {
    data: collection,
    isLoading: isLoadingCollection,
    error: collectionError,
  } = useCollectionSchema(slug);

  // Fetch entry data with relationship expansion
  // depth: 2 ensures relationship fields include display labels (title, name, etc.)
  // i18n M7: on a localized app, request the per-locale translation-status overview so the editor
  // can show per-language status pills. Inert (param omitted) for non-localized apps.
  const { defaultLocale, enabled: localizationEnabled } = useLocalization();

  const {
    data: entry,
    isLoading: isLoadingEntry,
    error: entryError,
  } = useEntry({
    collectionSlug: slug || "",
    entryId: id,
    depth: 2,
    // Load the pending working draft in place of the live row when the
    // collection has the draft/published split enabled, so the editor shows and
    // saves onto the unpublished edits. Inert for non-drafts collections (the
    // server only overlays a draft it actually has).
    draft: collection?.draftsEnabled === true,
    locale,
    // Edit the ACTUAL per-locale values — disable fallback so an untranslated field
    // shows empty (not the default-language text, which a save would otherwise persist
    // as this locale's translation). sourceEntry (below) supplies the default-language
    // hint. Gated on localizationEnabled so a non-localized app sends no fallback param.
    fallbackLocale: localizationEnabled ? "none" : undefined,
    translationStatus: localizationEnabled,
  });

  // i18n M7: while translating a non-default language, also load the default-language entry so
  // the editor can show the source text inline on each translatable field (spec §10). Gated so
  // it only fires when actually translating another language; editing the default language reuses
  // the primary fetch above (same cache key) and needs no source copy.
  const isNonDefaultLocale =
    !!locale && !!defaultLocale && locale !== defaultLocale;
  /*
   * Called HERE, above this component's loading and error returns, because it
   * is a hook and the page returns early several times below. What it produces
   * is only read once those guards have passed; while the collection is still
   * loading it reports no action, which is correct — there is nothing on screen
   * to contribute one to.
   */
  const release = useAddToReleaseAction({
    scopeKind: "collection",
    scopeSlug: slug,
    entryId: id,
    // The same flag the editor's own publish controls read. A release member
    // performs a publish or unpublish, and the route refuses a collection whose
    // schema declares no lifecycle.
    lifecycleEnabled: collection?.status,
    onDefaultLocale: !isNonDefaultLocale,
  });
  const { translateFrom, enterTranslationMode, exitTranslationMode } =
    useTranslationMode({ activeLocale: locale, defaultLocale });
  // The language the source is read AT. Translation mode names it explicitly;
  // otherwise the inline hint's source has always been the app default.
  const { data: sourceEntry } = useEntry({
    collectionSlug: slug || "",
    entryId: id,
    depth: 2,
    locale: translateFrom ?? defaultLocale,
    enabled: isNonDefaultLocale || !!translateFrom,
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

  // Missing ID error state
  if (!id) {
    return (
      <PageContainer width={CONTENT_PAGE_MEASURE}>
        <Alert variant="destructive">
          <AlertDescription>
            No entry ID was specified in the URL.
          </AlertDescription>
        </Alert>
        <div className="mt-6 flex items-center gap-2">
          <Link href={buildRoute(ROUTES.COLLECTION_ENTRIES, { slug })}>
            <Button variant="outline">← Back to {slug}</Button>
          </Link>
          {/* A failed load while a non-default language is active is usually a
              failure of THAT fetch, and the default language is still likely to
              load — so offer the way back to it instead of stranding the
              editor with only an exit. Resetting the locale re-keys the query,
              which is the retry. */}
          {locale !== undefined && (
            <Button variant="outline" onClick={resetLocale}>
              Back to the default language
            </Button>
          )}
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
      <PageContainer width={CONTENT_PAGE_MEASURE}>
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

  // Entry not found
  if (!entry) {
    return (
      <PageContainer width={CONTENT_PAGE_MEASURE}>
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
  const entryTitle = getEntryTitle(entryData, id, collection.admin?.useAsTitle);

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
        <MeasuredPageFrame
          breadcrumbs={
            <EditEntryBreadcrumbs
              collectionSlug={slug}
              collectionLabel={collectionLabel}
              entryTitle={entryTitle}
            />
          }
        >
          {/* A custom edit view replaces the FORM, not the facts about the
              document. Its editor is as able to save changes into a scheduled
              release as any other, and omitting the banner here would withhold
              the warning from precisely the documents a project cared enough
              about to build a bespoke editor for. */}
          <ScheduledReleaseBanner
            document={{ scopeKind: "collection", scopeSlug: slug, entryId: id }}
            onDefaultLocale={!isNonDefaultLocale}
          />
          {/* Boxed for the same reason the injection slots are: under the
              measured frame this is a direct child of a CSS grid, and the rule
              that puts a child in the content column can only place a
              generated element box. A view rooted in bare text, or in an
              element with `display: contents`, produces none and is
              auto-placed into a gutter. The registry imposes no root-element
              contract, so the page provides the box. */}
          <div>
            <PluginSlot
              path={customEditViewPath}
              props={customViewProps as unknown as Record<string, unknown>}
            />
          </div>
        </MeasuredPageFrame>
      </QueryErrorBoundary>
    );
  }

  // Default: render the EntryForm directly. Breadcrumbs were removed from
  // form, not the header chrome. Before/AfterEdit injection points (D23) are
  // resolved + isolated via PluginSlot around the form.
  const beforeEditPath = collection.admin?.components?.BeforeEdit;
  const afterEditPath = collection.admin?.components?.AfterEdit;
  const editInjectionProps: Record<string, unknown> = {
    collectionSlug: slug,
    entryId: id,
    collection: collection,
    entry: entryData,
  };

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <MeasuredPageFrame contentCarriesMeasure>
        {/* Each injection slot gets a box of its own. Under the measured
            frame these are direct children of a CSS grid, and the rule that
            puts a child in the content column can only place a generated
            element box: a plugin whose root is bare text, or an element with
            `display: contents`, produces none and is auto-placed into a gutter
            instead. The registry imposes no root-element contract on a plugin,
            so the page provides the box rather than trusting it to. */}
        {beforeEditPath && (
          <div
            // Bounded here rather than inheriting the page, which no longer
            // caps: the frame gives the panel to the form-and-rail row, and a
            // slot outside that row would otherwise stretch the whole width.
            // Plugin content keeps the measure it had before the row took the
            // panel, so nothing a plugin renders changes shape.
            className="mx-auto w-full"
            style={{ maxWidth: CONTENT_MEASURE_LENGTH }}
          >
            <PluginSlot path={beforeEditPath} props={editInjectionProps} />
          </div>
        )}
        {/* FULL WIDTH and first, matching the historical-version banner: this
            is a standing fact about the whole document, and a bar constrained
            to the content measure reads as a note about the fields under it.
            It does not touch the per-language staleness markers in the language
            panel — those answer a different question, and a stale translation
            inside a scheduled release is exactly where an editor needs both. */}
        <ScheduledReleaseBanner
          document={{ scopeKind: "collection", scopeSlug: slug, entryId: id }}
          onDefaultLocale={!isNonDefaultLocale}
        />
        {release.dialog}
        <EntryForm
          collection={collection as unknown as EntryFormCollection}
          entry={entry}
          mode="edit"
          /* The same destination the entry list already sends people to, and
             the replacement the header's menu now names where `Show JSON` used
             to be. The route knows how to navigate; the form does not. */
          onViewApi={() =>
            navigateTo(buildRoute(ROUTES.COLLECTION_ENTRY_API, { slug }))
          }
          /* Contributed to the editor's action model, which places it in the
             overflow menu beside Duplicate. Adding a document to a release is a
             document-management act, not a leading one — and as a toolbar
             button it also widened the action cluster, which is what pushed
             Save under the version-history panel. */
          documentActions={
            release.contributed === null ? [] : [release.contributed]
          }
          locale={locale}
          onLocaleChange={changeLocale}
          {...(seedFromLocale === undefined ? {} : { seedFromLocale })}
          onSeedHandled={clearSeed}
          sourceValues={sourceEntry}
          translation={{
            from: translateFrom,
            sourceDocument: sourceEntry,
            onEnter: enterTranslationMode,
            onExit: exitTranslationMode,
          }}
          onSuccess={handleSuccess}
          onDelete={handleDelete}
          onCancel={handleCancel}
        />
        {afterEditPath && (
          <div
            // Bounded here rather than inheriting the page, which no longer
            // caps: the frame gives the panel to the form-and-rail row, and a
            // slot outside that row would otherwise stretch the whole width.
            // Plugin content keeps the measure it had before the row took the
            // panel, so nothing a plugin renders changes shape.
            className="mx-auto w-full"
            style={{ maxWidth: CONTENT_MEASURE_LENGTH }}
          >
            <PluginSlot path={afterEditPath} props={editInjectionProps} />
          </div>
        )}
      </MeasuredPageFrame>
    </QueryErrorBoundary>
  );
}
