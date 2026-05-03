/**
 * Entry Form Component
 *
 * Main entry form component that orchestrates all form parts:
 * - useEntryForm hook for state management
 * - EntryFormProvider for form context
 * - EntryFormHeader for title and actions
 * - EntryFormContent for field rendering
 * - EntryFormSidebar for metadata
 * - EntryFormActions for submit/cancel
 *
 * Supports both standalone (page) and embedded (modal) modes.
 *
 * @module components/entries/EntryForm/EntryForm
 * @since 1.0.0
 */

import { Card, CardContent } from "@revnixhq/ui";
import type React from "react";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { useEntryPreview } from "@admin/hooks/useEntryPreview";
import { useEntryFormShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import { cn } from "@admin/lib/utils";

import { EntryFormActions } from "./EntryFormActions";
import { EntryFormContent } from "./EntryFormContent";
import { EntryFormContextProvider } from "./EntryFormContext";
import { EntryFormHeader } from "./EntryFormHeader";
import { EntryFormProvider } from "./EntryFormProvider";
import { EntryFormSidebar } from "./EntryFormSidebar";
import { FormErrorSummary } from "./FormErrorSummary";
import {
  useEntryForm,
  getCollectionFields,
  type EntryFormCollection,
  type EntryData,
  type EntryFormMode,
} from "./useEntryForm";

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
  /** Custom components to inject into the form layout flow */
  headerContent?: React.ReactNode;
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
  headerContent,
}: EntryFormProps) {
  const {
    form,
    handleSubmit,
    handleDelete,
    handleCancel,
    isSubmitting,
    isDeleting,
    isDirty,
    singularLabel,
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

  // Get all fields and split them based on admin.position
  const allFields = getCollectionFields(collection);

  // Extract slug and seo specifically for the sidebar tabs (Phase 3 requirements)
  const slugField = allFields.find(f => f.name === "slug");
  const seoField = allFields.find(
    f =>
      f.name === "seo" ||
      (f.type === "group" && f.name?.toLowerCase().includes("seo"))
  );
  const titleField = allFields.find(f => f.name === "title");

  const mainFields = allFields.filter(
    f =>
      f.admin?.position !== "sidebar" &&
      f.name !== "slug" &&
      f.name !== "title" &&
      f !== seoField
  );

  const sidebarFields = allFields.filter(
    field =>
      field.admin?.position === "sidebar" &&
      field.name !== "slug" &&
      field !== seoField
  );

  // Get form errors for summary display
  const { errors } = form.formState;

  // Preview functionality
  const {
    isPreviewAvailable,
    openPreview,
    label: previewLabel,
  } = useEntryPreview({
    collection,
    entry: entry,
    getFormValues: () => form.getValues(),
  });

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts (standalone mode only)
  // ---------------------------------------------------------------------------

  // Only enable shortcuts in standalone mode (not embedded modals)
  useEntryFormShortcuts({
    onSave: () => { void handleSubmit(); },
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

  // Standalone mode: full layout with header, sidebar, and actions
  return (
    <EntryFormContextProvider
      entryId={entry?.id}
      collectionSlug={collection.name}
      isCreateMode={mode === "create"}
    >
      <div className={cn("space-y-6", className)}>
        {/* Main Form */}
        <EntryFormProvider form={form} onSubmit={handleSubmit}>
          {/* Error summary at top of form */}
          <FormErrorSummary errors={errors} className="mb-6" />

          <div className="flex flex-col lg:flex-row lg:min-h-[calc(100vh-4rem)] items-stretch lg:-m-8">
            {/* Main Content */}
            <div className="flex-1 lg:p-8 pt-6">
              <div className="mb-6">{headerContent}</div>
              <EntryFormHeader
                collectionSlug={collection.name}
                singularLabel={singularLabel}
                mode={mode}
                entry={entry}
                isDeleting={isDeleting}
                onDelete={handleDelete}
                isDirty={isDirty}
              />
              {/* Custom Title & Slug row */}
              {(titleField || slugField) && (
                <div className="mb-6">
                  <Card>
                    <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                      {titleField && (
                        <div className="w-full">
                          <FieldRenderer
                            field={titleField}
                            disabled={isSubmitting}
                            readOnly={false}
                          />
                        </div>
                      )}
                      {slugField && (
                        <div className="w-full">
                          <FieldRenderer
                            field={slugField}
                            disabled={isSubmitting}
                            readOnly={false}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {mainFields.length > 0 && (
                <EntryFormContent
                  fields={mainFields}
                  disabled={isSubmitting}
                  withCard
                />
              )}
            </div>

            {/* Sidebar */}
            <div className="w-full lg:w-[360px] shrink-0  border-t border-primary/5 lg:border-t-0 lg :border-l border-primary/5 lg:border-primary/5 bg-background flex flex-col relative z-10">
              <div className="lg:sticky lg:top-0 lg:h-[calc(100vh-4rem)] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex flex-col">
                <EntryFormSidebar
                  mode={mode}
                  entry={entry}
                  fields={sidebarFields}
                  seoField={seoField}
                  actions={
                    <EntryFormActions
                      mode={mode}
                      isSubmitting={isSubmitting}
                      onCancel={handleCancel}
                      isPreviewAvailable={isPreviewAvailable}
                      onPreview={openPreview}
                      previewLabel={previewLabel}
                    />
                  }
                />
              </div>
            </div>
          </div>
        </EntryFormProvider>
      </div>
    </EntryFormContextProvider>
  );
}
