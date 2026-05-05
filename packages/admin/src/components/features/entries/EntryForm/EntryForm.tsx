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

import { useEntryFormShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import { cn } from "@admin/lib/utils";

import { EntryFormActions } from "./EntryFormActions";
import { EntryFormContent } from "./EntryFormContent";
import { EntryFormContextProvider } from "./EntryFormContext";
import { EntryFormProvider } from "./EntryFormProvider";
import { EntryFormSidebar } from "./EntryFormSidebar";
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
    onSuccess: data => {
      onSuccess?.(data);
    },
    onError,
    onDelete,
    onCancel,
  });

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

  const mainFields = allFields.filter(
    f => f.name !== "slug" && f.name !== "title"
  );

  // Get form errors for summary display
  const { errors } = form.formState;

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
            <FormErrorSummary errors={errors} />
            <EntryFormContent
              fields={getCollectionFields(collection)}
              disabled={isSubmitting}
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
    <EntryFormContextProvider
      entryId={entry?.id}
      collectionSlug={collection.name}
      isCreateMode={mode === "create"}
    >
      <div className={cn("space-y-0", className)}>
        <EntryFormProvider form={form} onSubmit={handleSubmit}>
          <FormErrorSummary errors={errors} className="mx-6 mt-3" />

          <div className="flex flex-col lg:flex-row lg:min-h-[calc(100vh-4rem)] items-stretch lg:-m-8">
            {/* Main column */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="-mx-8">
                <EntrySystemHeader
                  mode={mode}
                  titleField={titleField}
                  hasStatus={hasStatus}
                  isSubmitting={isSubmitting}
                  isDirty={isDirty}
                  entry={entry}
                  collectionSlug={collection.name}
                  onSaveDraft={() => {
                    void handleSubmit(undefined, "draft");
                  }}
                  onPublish={() => {
                    void handleSubmit(undefined, "published");
                  }}
                  onCancel={handleCancel}
                  onDelete={handleDelete}
                  isRailCollapsed={railCollapsed}
                  onToggleRail={toggleRail}
                />
              </div>
              <div className="-mx-8">
                <EntryMetaStrip
                  slugField={slugField}
                  hasStatus={hasStatus}
                  status={(entry?.status as string | undefined) ?? "draft"}
                  isRailCollapsed={railCollapsed}
                />
              </div>

              {mainFields.length > 0 && (
                <div className="lg:p-8 pt-6">
                  <EntryFormContent
                    fields={mainFields}
                    disabled={isSubmitting}
                    withCard
                  />
                </div>
              )}
            </div>

            {/* Rail (collapsible). Width 320px. Hidden under 1024px until a
                future mobile sheet ships. */}
            {!railCollapsed && (
              <div className="hidden lg:flex w-[320px] shrink-0 border-l border-primary/5 bg-background flex-col relative z-10">
                <div className="lg:sticky lg:top-0 lg:h-[calc(100vh-4rem)] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex flex-col">
                  <EntryFormSidebar
                    mode={mode}
                    entry={entry}
                    hasStatus={hasStatus}
                  />
                </div>
              </div>
            )}
          </div>
        </EntryFormProvider>
      </div>
    </EntryFormContextProvider>
  );
}
