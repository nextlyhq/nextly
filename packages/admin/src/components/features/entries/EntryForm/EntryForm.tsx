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
import { useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useAutoSlug } from "@admin/hooks/useAutoSlug";
import { useEntryFormShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import { useLocalization } from "@admin/hooks/useLocalization";
import {
  computeMainFields,
  takeoverControllerNames,
  takeoverTypesFromBranding,
} from "@admin/lib/builder/takeoverLayout";
import { cn } from "@admin/lib/utils";

import { EntryLocaleProvider } from "../EntryLocaleContext";

import { EntryFormActions } from "./EntryFormActions";
import { EntryFormContent } from "./EntryFormContent";
import { EntryFormContextProvider } from "./EntryFormContext";
import { EntryFormProvider } from "./EntryFormProvider";
import { EntryFormSidebar } from "./EntryFormSidebar";
import { EntryFormToolbarSlots } from "./EntryFormToolbarSlots";
import { EntryMetaStrip } from "./EntryMetaStrip";
import { EntrySystemHeader } from "./EntrySystemHeader";
import { FormErrorSummary } from "./FormErrorSummary";
import {
  useEntryForm,
  getCollectionFields,
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
  onLocaleChange,
  sourceValues,
  embedded = false,
  className,
}: EntryFormProps) {
  const {
    form,
    handleSubmit,
    handleDelete,
    handleCancel,
    isSubmitting,
    isDirty,
  } = useEntryForm({
    collection,
    entry,
    mode,
    locale,
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
  useAutoSlug({
    form,
    titleFieldName: titleField?.name ?? "title",
    slugFieldName: slugField?.name ?? "slug",
    enabled: !!titleField && !!slugField,
  });

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts (standalone mode only)
  // ---------------------------------------------------------------------------

  // Only enable shortcuts in standalone mode (not embedded modals)
  useEntryFormShortcuts({
    onSave: () => {
      void handleSubmit();
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
                  isSubmitting={isSubmitting}
                  isDirty={isDirty}
                  entry={entry}
                  collectionSlug={collection.name}
                  locale={locale}
                  onLocaleChange={onLocaleChange}
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
                  onUnpublish={() => {
                    void handleSubmit(undefined, "unpublish");
                  }}
                  onCancel={handleCancel}
                  onDelete={handleDelete}
                  isRailCollapsed={railCollapsed}
                  onToggleRail={mode === "edit" ? toggleRail : undefined}
                />
                <EntryMetaStrip
                  slugField={slugField}
                  hasStatus={hasStatus}
                  status={(entry?.status as string | undefined) ?? "draft"}
                  isRailCollapsed={railCollapsed}
                />

                {mainFields.length > 0 && (
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
                )}
              </div>

              {/* Rail (collapsible). Width 320px. Hidden until the content panel
                is wide enough (@4xl) to fit it beside the main column, until a
                future mobile sheet ships.

                Why mode === "edit" gate (Task 7 PR-4): in create mode the
                entry doesn't exist yet, so DocumentPanel returns null
                anyway. Rendering the empty 320px container left a blank
                strip down the right side of the page (item 7 of
                07-admin-bugs-feedback). Skip the whole block until the
                entry exists. */}
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
    </EntryLocaleProvider>
  );
}
