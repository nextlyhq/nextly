/**
 * Entry Form Component
 *
 * Main entry form component that orchestrates all form parts:
 * - useEntryForm hook for state management
 * - EntryFormProvider for form context
 * - EntrySystemHeader for title input + actions + dropdown + rail toggle
 * - EntryMetaStrip for slug + status pill (when rail collapsed)
 * - EntryFormContent for field rendering (Builder-defined fields only)
 * - EntryFormSidebar for system metadata (Document panel only)
 *
 * Supports both standalone (page) and embedded (modal) modes.
 *
 * @module components/entries/EntryForm/EntryForm
 * @since 1.0.0
 */

import { resolveLocalizedFieldNames } from "nextly/config";
import { useCallback, useMemo, useState } from "react";

import {
  DocumentHistoryContext,
  type ViewedVersion,
} from "@admin/components/features/versions/document-history-context";
import { HistoricalDocumentBanner } from "@admin/components/features/versions/HistoricalDocumentBanner";
import { historyEnabledFrom } from "@admin/components/features/versions/history-enabled";
import { VersionSnapshotForm } from "@admin/components/features/versions/VersionSnapshotForm";
import { Alert, AlertDescription, Skeleton } from "@admin/components/ui";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useGeneralSettings } from "@admin/hooks/queries/useGeneralSettings";
import { useAutosaveRecovery } from "@admin/hooks/useAutosaveRecovery";
import { useAutoSlug } from "@admin/hooks/useAutoSlug";
import {
  autosaveScopeFor,
  useDocumentAutosave,
} from "@admin/hooks/useDocumentAutosave";
import { useEntryFormShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import { useLocalization } from "@admin/hooks/useLocalization";
import { usePreviewLink } from "@admin/hooks/usePreviewLink";
import {
  computeMainFields,
  takeoverControllerNames,
  takeoverTypesFromBranding,
} from "@admin/lib/builder/takeoverLayout";
import { cn } from "@admin/lib/utils";

import { EntryLocaleProvider } from "../EntryLocaleContext";

import { AutosaveRecoveryBanner } from "./AutosaveRecoveryBanner";
import {
  effectiveEntryStatus,
  isSlugPerLocale,
  previewLinkLocale,
  previewLinkSiteUrl,
  useHasPublicAddress,
} from "./entry-address";
import { EntryFormActions } from "./EntryFormActions";
import { EntryFormContent } from "./EntryFormContent";
import { EntryFormContextProvider } from "./EntryFormContext";
import { EntryFormProvider } from "./EntryFormProvider";
import { EntryFormSidebar } from "./EntryFormSidebar";
import { EntryFormToolbarSlots } from "./EntryFormToolbarSlots";
import { EntryMetaStrip } from "./EntryMetaStrip";
import { EntrySystemHeader } from "./EntrySystemHeader";
import { FormErrorSummary } from "./FormErrorSummary";
import { PublicUrlChangeNotice } from "./PublicUrlChangeNotice";
import {
  useEntryForm,
  getCollectionFields,
  resolveDefaultSaveIntent,
  type EntryFormCollection,
  type EntryData,
  type EntryFormMode,
} from "./useEntryForm";
import { useRailCollapsed } from "./useRailCollapsed";

// ============================================================================
// Types
// ============================================================================

export interface EntryFormProps {
  /** Collection configuration with field schema */
  collection: EntryFormCollection;
  /** Existing entry data (for edit mode) */
  entry?: EntryData | null;
  /** Form mode - 'create' or 'edit' */
  mode: EntryFormMode;
  /** Callback when form is successfully submitted */
  onSuccess?: (entry: EntryData) => void;
  /** Callback when form submission fails */
  onError?: (error: unknown) => void;
  /** Callback when entry is deleted (edit mode only) */
  onDelete?: () => void;
  /** Callback when form is cancelled */
  onCancel?: () => void;
  /** Active content locale (i18n M7) — saves target this language. */
  locale?: string;
  /**
   * Whether the parent read this entry with the working-draft overlay (`draft`).
   * Forwarded to the update so its optimistic cache key matches the query on
   * screen. Omit for the full-page editor (it reads the overlay for a drafts
   * collection); an embedded editor reading the live row passes `false`.
   */
  readDraft?: boolean;
  /** Called when the user switches the active content language (i18n M7). */
  onLocaleChange?: (locale: string) => void;
  /**
   * Default-language field values (i18n M7). Provided while translating a non-default language
   * so each translatable field can show its source text inline. Keyed by field name (camelCase).
   */
  sourceValues?: Record<string, unknown>;
  /**
   * Embedded mode for use in modals.
   * When true:
   * - Header is hidden (modal provides its own)
   * - Sidebar is hidden
   * - Layout is single column
   */
  embedded?: boolean;
  /** Additional CSS classes for the form container */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EntryForm - Complete entry create/edit form
 *
 * A fully-featured form component for creating and editing collection entries.
 * Automatically generates form fields from collection schema, handles validation
 * with Zod, and manages create/update/delete operations.
 *
 * ## Modes
 *
 * - **Standalone (default)**: Full-featured form with header, two-column layout,
 *   sidebar, and action buttons. Used on dedicated create/edit pages.
 *
 * - **Embedded**: Simplified layout for use in modals (e.g., RelationshipCreateModal).
 *   No header, no sidebar, single column layout.
 *
 * ## Features
 *
 * - Dynamic form generation from collection schema
 * - Zod validation from field configurations
 * - Create and edit modes
 * - Two-column layout with metadata sidebar (standalone)
 * - Actions dropdown with delete/duplicate (edit mode)
 * - Loading and submitting states
 * - Dirty state tracking
 * - **Unsaved changes protection** - prompts before navigation when dirty (standalone only)
 * - **Server error mapping** - maps server validation errors to form fields with summary
 * - **Auto-save to localStorage** - debounced saves with visual indicator (standalone only)
 * - **Draft recovery** - offers to recover unsaved changes on page revisit
 *
 * @example Standalone create mode
 * ```tsx
 * <EntryForm
 *   collection={collection}
 *   mode="create"
 *   onSuccess={(entry) => navigate(`/entries/${entry.id}`)}
 *   onCancel={() => navigate("/entries")}
 * />
 * ```
 *
 * @example Standalone edit mode
 * ```tsx
 * <EntryForm
 *   collection={collection}
 *   entry={existingEntry}
 *   mode="edit"
 *   onSuccess={() => toast.success("Saved!")}
 *   onDelete={() => navigate("/entries")}
 *   onDuplicate={handleDuplicate}
 *   onCancel={() => navigate("/entries")}
 * />
 * ```
 *
 * @example Embedded in modal
 * ```tsx
 * <Dialog open={open} onOpenChange={setOpen}>
 *   <DialogContent>
 *     <DialogHeader>
 *       <DialogTitle>Create New {collection.label}</DialogTitle>
 *     </DialogHeader>
 *     <EntryForm
 *       collection={collection}
 *       mode="create"
 *       embedded
 *       onSuccess={(entry) => {
 *         onCreated(entry);
 *         setOpen(false);
 *       }}
 *       onCancel={() => setOpen(false)}
 *     />
 *   </DialogContent>
 * </Dialog>
 * ```
 */
export function EntryForm({
  collection,
  entry,
  mode,
  onSuccess,
  onError,
  onDelete,
  onCancel,
  locale,
  readDraft,
  onLocaleChange,
  sourceValues,
  embedded = false,
  className,
}: EntryFormProps) {
  const {
    form,
    handleSubmit,
    handleDelete,
    handleDiscardWorkingDraft,
    handleCancel,
    isSubmitting,
    isDirty,
  } = useEntryForm({
    collection,
    entry,
    mode,
    locale,
    readDraft,
    onSuccess: data => {
      onSuccess?.(data);
    },
    onError,
    onDelete,
    onCancel,
  });

  // i18n M7: content-locale context for field components — the active locale's writing
  // direction (RTL for Arabic/Hebrew/…), the collection's master localization switch (so a
  // field can tell whether it is translatable), and whether the active language differs from
  // the app default (per-field affordances only apply while translating a non-default language).
  // All inert for LTR / non-localized editors — the plain path is unchanged.
  const { getLocale, defaultLocale } = useLocalization();
  const localeCtx = useMemo(() => {
    const collectionLocalized = collection.localized === true;
    return {
      locale,
      // `locale` is undefined while editing the implicit default language, so
      // resolve the default explicitly — otherwise a default-locale that is RTL
      // would render its translatable fields left-to-right until explicitly picked.
      rtl: getLocale(locale ?? defaultLocale)?.rtl ?? false,
      collectionLocalized,
      isNonDefaultLocale:
        !!locale && !!defaultLocale && locale !== defaultLocale,
      sourceValues,
      onLocaleChange,
      collectionSlug: collection.slug ?? collection.name,
      entryId: entry?.id ?? undefined,
      // The translatable-field set, for the field-scoped copy-from-language action.
      localizedFieldNames: resolveLocalizedFieldNames(
        getCollectionFields(collection).map(f => ({
          type: (f as { type?: string }).type ?? "",
          name: (f as { name?: string }).name ?? "",
          localized: (f as { localized?: boolean }).localized,
        })),
        collectionLocalized
      ),
    };
  }, [
    locale,
    getLocale,
    defaultLocale,
    collection,
    sourceValues,
    onLocaleChange,
    entry?.id,
  ]);

  // Get all fields. Title and slug are extracted as system fields rendered in
  // their own header card (this PR keeps the existing title/slug special-case;
  // PR 6 of the redesign moves them into the new pinned-headline + rail-slug
  // layout). Per Q-D1=B in the redesign spec, the rail is system-content only:
  // no user-defined fields may use `admin.position: 'sidebar'`, and any
  // legacy `seoField` name match is dropped — components (including ones
  // named "seo") render inline like every other field.
  const allFields = getCollectionFields(collection);
  const slugField = allFields.find(f => f.name === "slug");
  const titleField = allFields.find(f => f.name === "title");

  // Takeover layout: when a field whose type is flagged `layout: "takeover"` is
  // active (its condition passes), show only that field + its condition controller;
  // otherwise the full body. Generic — driven by field-type metadata, not by any
  // specific plugin. (title/slug/status are separate system components, always kept.)
  const branding = useBranding();
  const takeoverTypes = takeoverTypesFromBranding(branding.plugins);
  const controllerNames = takeoverControllerNames(allFields, takeoverTypes);
  const watched = controllerNames.length ? form.watch(controllerNames) : [];
  const values = Object.fromEntries(
    controllerNames.map((n, i) => [n, watched[i]])
  );
  const mainFields = computeMainFields(allFields, { takeoverTypes, values });

  // Get form errors and submit attempt count. submitCount gates the
  // top-level "Please fix the following errors" toast in FormErrorSummary
  // so it only appears after the user actually clicks Save / Publish, not
  // when a field-level revalidation runs after that first attempt.
  const { errors, submitCount } = form.formState;

  // Rail collapse state. Toggle lives in EntrySystemHeader; the rail itself
  // reads `railCollapsed` to decide whether to render. Persisted in
  // localStorage so the choice survives reloads.
  const { collapsed: railCollapsed, toggle: toggleRail } = useRailCollapsed();
  // Which past version the document area is showing, or null for the live
  // document. Held here because this is the component that swaps the document,
  // and published downward because the panel that chooses it is mounted from
  // the header, several levels below.
  const [viewingVersion, setViewingVersion] = useState<ViewedVersion | null>(
    null
  );
  const documentHistory = useMemo(
    () => ({ viewing: viewingVersion, setViewing: setViewingVersion }),
    [viewingVersion]
  );

  // Whether this collection has Draft/Published status enabled at the meta
  // level. When true, the system header splits into Save Draft + Publish/Update
  // and the Document panel + meta strip surface the status pill. When false,
  // the system header collapses to a single Save/Create button and the pill
  // is hidden.
  const hasStatus = collection.status === true;

  // Auto-fill slug from title while the slug looks auto-generated. Why a
  // form-level hook: the title input lives in EntrySystemHeader as a plain
  // <input> bound via form.register, not through TextInput, so the per-field
  // slug-gen logic that used to live in TextInput never fired for the
  // configured title. Mounting the hook here closes that gap and follows the
  // configured title field name (not a hardcoded "title"/"name").
  // Once an entry has a public address its slug stops following its title. That address is in
  // links, feeds, sitemaps and search results, so re-deriving it from an edited title retires a URL
  // the author never chose to change and the old one 404s. Editing the slug directly still works;
  // this only stops the automatic rewrite.
  // The auto-injected slug is shared across languages, so one address serves them all and any
  // published language keeps it frozen. Only a slug the author opted into localizing belongs to
  // the language in view.
  const hasPublicAddress = useHasPublicAddress({
    mode,
    hasStatus,
    entry,
    locale,
    slugLocalized: isSlugPerLocale(slugField, collection.localized === true),
    collectionLocalized: collection.localized === true,
    defaultLocale,
    mutationPending: isSubmitting,
  });

  useAutoSlug({
    form,
    titleFieldName: titleField?.name ?? "title",
    slugFieldName: slugField?.name ?? "slug",
    enabled: !!titleField && !!slugField,
    frozen: hasPublicAddress,
  });

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts (standalone mode only)
  // ---------------------------------------------------------------------------

  // Route Cmd/Ctrl+S to the same intent the primary Save button uses for this
  // document's state, so a keyboard save and a button save behave identically:
  // on a drafts collection a published entry stores a working draft
  // (status-less), on a non-drafts collection it re-asserts published, and any
  // other editing state saves a draft. Create mode and non-status collections
  // keep the intent-less single-Save behavior.
  const keyboardSaveIntent = resolveDefaultSaveIntent({
    mode,
    hasStatus,
    // The ACTIVE locale's status, not the main row's — the same effective status
    // the header's submit buttons use, so a keyboard save and a button save agree.
    effectiveStatus: effectiveEntryStatus(entry, locale, defaultLocale),
    draftsEnabled: collection.draftsEnabled === true,
  });

  // A link names one saved document, so there is nothing to mint against until
  // the entry exists. The id is read here rather than inside the hook because
  // hooks run unconditionally: on create the mutation is constructed and never
  // reachable, since the control that would call it is not rendered.
  const { data: generalSettings } = useGeneralSettings();
  const savedEntryId = entry?.id === undefined ? "" : String(entry.id);

  // Recovery points for this author, recorded while they type. Addressed only
  // once the entry has an id: a document that has never been saved has nothing
  // for the endpoint to address, and `null` turns recording off rather than
  // inventing one.
  const autosaveScope = useMemo(
    () => autosaveScopeFor("collection", collection.name, savedEntryId),
    [savedEntryId, collection.name]
  );
  // The other half of recording: offer the work back when the editor opens.
  const recovery = useAutosaveRecovery({
    scope: autosaveScope,
  });
  const restoreRecovery = useCallback(() => {
    if (!recovery.offer) return;
    // `reset` with `keepDefaultValues` so the form goes DIRTY: the recovered
    // values are not what the server holds, and treating them as the new
    // baseline would let the reader navigate away believing they were stored.
    form.reset(recovery.offer.snapshot as Record<string, unknown>, {
      keepDefaultValues: true,
    });
    recovery.dismiss();
  }, [recovery, form]);

  const autosave = useDocumentAutosave({
    scope: autosaveScope,
    form,
    locale: locale ?? null,
    // Held off while a real save is in flight. The document is about to change
    // underneath the snapshot, so a recovery point written now would describe a
    // state that never existed.
    enabled: !isSubmitting,
  });
  const linkLocale = previewLinkLocale({
    localized: collection.localized === true,
    locale,
    defaultLocale,
  });
  // A link that travels by email or chat has to name a host. `window` is read
  // through a guard because this module is imported in a server render, where
  // there is no origin and the configured site is the only source anyway.
  const linkSiteUrl = previewLinkSiteUrl({
    configured: generalSettings?.siteUrl,
    origin: typeof window === "undefined" ? undefined : window.location.origin,
  });
  const previewLink = usePreviewLink({
    collection: collection.name,
    entryId: savedEntryId,
    ...(linkLocale.kind === "scoped" ? { locale: linkLocale.locale } : {}),
    ...(linkSiteUrl === undefined ? {} : { siteUrl: linkSiteUrl }),
  });

  // Only enable shortcuts in standalone mode (not embedded modals)
  useEntryFormShortcuts({
    onSave: () => {
      void handleSubmit(undefined, keyboardSaveIntent);
    },
    onCancel: handleCancel,
    isDirty,
    isSubmitting,
    enabled: !embedded,
  });

  // Embedded mode: simplified single-column layout for modals
  // Note: Preview is typically not shown in embedded mode (modals)
  if (embedded) {
    return (
      <EntryFormContextProvider
        entryId={entry?.id}
        collectionSlug={collection.name}
        isCreateMode={mode === "create"}
      >
        <EntryFormProvider
          form={form}
          onSubmit={handleSubmit}
          className={className}
        >
          <div className="space-y-6">
            {/* Error summary at top of form */}
            <FormErrorSummary errors={errors} submitCount={submitCount} />
            {/* This branch renders every collection field, the editable slug among them, but not
                the meta strip that carries the notice in the standalone layout. Quick-edit from a
                relationship picker lands here on existing entries, so without this the one place
                the warning is skipped is also a place a live URL can be rewritten and saved. */}
            {slugField && (
              <PublicUrlChangeNotice
                slugName={slugField.name ?? "slug"}
                active={hasPublicAddress}
                className="block"
              />
            )}
            {/* Forward the form mode so write-only password fields render
                their edit-mode affordance: on edit a blank password input
                means "keep the current password" (the stored hash never
                round-trips), so it is not treated as a required-field miss. */}
            <EntryFormContent
              fields={getCollectionFields(collection)}
              disabled={isSubmitting}
              mode={mode}
            />
            <EntryFormActions
              mode={mode}
              isSubmitting={isSubmitting}
              onCancel={handleCancel}
            />
          </div>
        </EntryFormProvider>
      </EntryFormContextProvider>
    );
  }

  // Standalone mode: compact layout — system header, meta strip, fields,
  // and (optional) right rail. No breadcrumbs, no DocumentTabs, no separate
  // page title h1; the title input lives inside EntrySystemHeader.
  return (
    <EntryLocaleProvider value={localeCtx}>
      <DocumentHistoryContext.Provider value={documentHistory}>
        <EntryFormContextProvider
          entryId={entry?.id}
          collectionSlug={collection.name}
          isCreateMode={mode === "create"}
        >
          <div className={cn("space-y-0", className)}>
            <EntryFormProvider form={form} onSubmit={handleSubmit}>
              <FormErrorSummary
                errors={errors}
                submitCount={submitCount}
                className="mx-6 mt-3"
              />

              <div className="flex flex-col @4xl/content:flex-row @4xl/content:min-h-[calc(100vh-4rem)] items-stretch @4xl/content:-m-8">
                {/* Main column */}
                <div className="flex-1 min-w-0 flex flex-col">
                  {/* Why: the parent flex's @4xl/content:-m-8 already cancels
                  PageContainer's px-8 padding so the form runs edge-to-edge
                  once the panel is wide enough. Wrapping the system
                  header / meta strip in another -mx-8 doubled the negative
                  margin and pushed both bands ~32px past the page edges on
                  each side — clipping the title's first character on the
                  left and the rail toggle / right-edge buttons on the right.
                  Letting them fill the Main column naturally fixes that. */}
                  <EntrySystemHeader
                    mode={mode}
                    titleField={titleField}
                    hasStatus={hasStatus}
                    draftsEnabled={collection.draftsEnabled === true}
                    isSubmitting={isSubmitting}
                    isDirty={isDirty}
                    autosaveEnabled={autosaveScope !== null}
                    autosaveStatus={autosave.status}
                    autosaveLastSavedAt={autosave.lastSavedAt}
                    entry={entry}
                    collectionSlug={collection.name}
                    historyFields={getCollectionFields(collection)}
                    historyEnabled={historyEnabledFrom(collection)}
                    locale={locale}
                    onLocaleChange={onLocaleChange}
                    localized={collection.localized === true}
                    // Withheld while the language is unknown as well as while
                    // the entry is unsaved: a link minted without a resolvable
                    // locale is either refused by the mint route or, if the claim
                    // were dropped to avoid that, a grant over every translation.
                    isLinkAvailable={
                      savedEntryId !== "" && linkLocale.kind !== "unresolved"
                    }
                    {...(savedEntryId === ""
                      ? {}
                      : {
                          onCopyLink: () => {
                            previewLink.mutate();
                          },
                        })}
                    isCopyingLink={previewLink.isPending}
                    toolbarSlot={
                      <EntryFormToolbarSlots
                        context="collection"
                        controllerField={controllerNames[0]}
                      />
                    }
                    onSaveDraft={() => {
                      void handleSubmit(undefined, "save-draft");
                    }}
                    onPublish={() => {
                      void handleSubmit(undefined, "publish");
                    }}
                    onSaveChanges={() => {
                      void handleSubmit(undefined, "save-changes");
                    }}
                    onSaveWorkingDraft={() => {
                      void handleSubmit(undefined, "save-working-draft");
                    }}
                    onUnpublish={() => {
                      void handleSubmit(undefined, "unpublish");
                    }}
                    onCancel={handleCancel}
                    onDelete={handleDelete}
                    onDiscardWorkingDraft={handleDiscardWorkingDraft}
                    isRailCollapsed={railCollapsed}
                    onToggleRail={mode === "edit" ? toggleRail : undefined}
                  />
                  {/* Above the fields and below the header: the reader sees
                    the document it refers to without the offer covering it. */}
                  {recovery.offer ? (
                    <AutosaveRecoveryBanner
                      savedAt={recovery.offer.savedAt}
                      onRestore={restoreRecovery}
                      onDismiss={recovery.dismiss}
                    />
                  ) : null}
                  {viewingVersion ? (
                    <HistoricalDocumentBanner
                      versionNo={viewingVersion.versionNo}
                      locale={viewingVersion.locale}
                      onReturnToCurrent={() => setViewingVersion(null)}
                    />
                  ) : null}
                  <EntryMetaStrip
                    slugField={slugField}
                    hasStatus={hasStatus}
                    // The pill reports the language being edited, matching the header's submit
                    // affordances. Reading the main row instead would show "Published" beside a
                    // Publish button whenever a translation lags its default language.
                    status={
                      effectiveEntryStatus(entry, locale, defaultLocale) ??
                      "draft"
                    }
                    hasWorkingDraft={
                      (
                        entry as
                          | { _isWorkingDraft?: boolean }
                          | null
                          | undefined
                      )?._isWorkingDraft === true
                    }
                    isRailCollapsed={railCollapsed}
                    hasPublicAddress={hasPublicAddress}
                  />

                  {/* Reading a past version replaces the document rather than
                    opening beside it: the question an editor is asking is how
                    this page read then, and that is answered by the page. The
                    live form stays mounted underneath — the historical values
                    are rendered against a form of their own, so nothing typed
                    here is disturbed and nothing historical can reach a save. */}
                  {viewingVersion ? (
                    <div className="@4xl/content:p-8 pt-6">
                      {viewingVersion.error ? (
                        // A failed read must not render as an empty document:
                        // that is a different and wrong claim about the version.
                        <Alert variant="destructive">
                          <AlertDescription>
                            This version could not be loaded.
                          </AlertDescription>
                        </Alert>
                      ) : viewingVersion.isLoading ? (
                        <div className="flex flex-col gap-4" aria-busy="true">
                          <span className="sr-only" role="status">
                            Loading version {viewingVersion.versionNo}
                          </span>
                          {[0, 1, 2, 3].map(i => (
                            <div key={i} className="flex flex-col gap-1">
                              <Skeleton className="h-3 w-24" />
                              <Skeleton className="h-9 w-full" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <VersionSnapshotForm
                          fields={mainFields}
                          snapshot={viewingVersion.snapshot}
                        />
                      )}
                    </div>
                  ) : (
                    mainFields.length > 0 && (
                      <div className="@4xl/content:p-8 pt-6">
                        {/* Forward the form mode: in edit mode a blank password
                      field means "keep the current password" rather than a
                      required-field violation (see note on the layout form
                      above). */}
                        <EntryFormContent
                          fields={mainFields}
                          disabled={isSubmitting}
                          withCard
                          mode={mode}
                        />
                      </div>
                    )
                  )}
                </div>

                {/* Rail (collapsible). Width 320px. Hidden until the content panel
                is wide enough (@4xl) to fit it beside the main column, until a
                future mobile sheet ships.

                The mode === "edit" gate: in create mode the entry does not
                exist yet, so DocumentPanel returns null and the rail has
                nothing to show. Rendering it anyway left an empty 320px
                strip down the right side of the page, which reads as a
                failed load rather than as an absence. */}
                {mode === "edit" && !railCollapsed && (
                  <div className="hidden @4xl/content:flex w-[320px] shrink-0 border-l border-border bg-background flex-col relative z-10">
                    <div className="@4xl/content:sticky @4xl/content:top-0 @4xl/content:h-[calc(100vh-4rem)] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex flex-col">
                      <EntryFormSidebar
                        mode={mode}
                        entry={entry}
                        hasStatus={hasStatus}
                        isDirty={isDirty}
                      />
                    </div>
                  </div>
                )}
              </div>
            </EntryFormProvider>
          </div>
        </EntryFormContextProvider>
      </DocumentHistoryContext.Provider>
    </EntryLocaleProvider>
  );
}
