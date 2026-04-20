/**
 * Single Form Component
 *
 * Form component for editing Single (Global) document data.
 * Singles are single-document entities that always exist and cannot be deleted.
 * This component provides:
 * - Dynamic field rendering based on Single schema
 * - Form validation with Zod
 * - Auto-save to localStorage
 * - Unsaved changes protection
 * - Keyboard shortcuts
 *
 * Unlike EntryForm, SingleForm:
 * - Only supports edit mode (no create/delete)
 * - Has a simpler header (no delete/duplicate actions)
 * - Uses separate hooks for document data vs schema
 *
 * @module components/singles/SingleForm
 * @since 1.0.0
 */

import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldConfig } from "@revnixhq/nextly/config";
import { Card, CardContent } from "@revnixhq/ui";
import React, { useEffect, useMemo, useCallback } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { DraftRecoveryDialog } from "@admin/components/features/entries/EntryForm/DraftRecoveryDialog";
import { EntryFormContent } from "@admin/components/features/entries/EntryForm/EntryFormContent";
import { EntryFormProvider } from "@admin/components/features/entries/EntryForm/EntryFormProvider";
import { FormErrorSummary } from "@admin/components/features/entries/EntryForm/FormErrorSummary";
import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { useAutoSave } from "@admin/hooks/useAutoSave";
import { useDraftRecovery } from "@admin/hooks/useDraftRecovery";
import { useEntryFormShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import { generateClientSchema } from "@admin/lib/field-validation";
import { cn } from "@admin/lib/utils";

import { SingleFormActions } from "./SingleFormActions";
import { SingleFormHeader } from "./SingleFormHeader";
import { SingleFormSidebar } from "./SingleFormSidebar";

// ============================================================================
// Types
// ============================================================================

/**
 * Single schema data (from useSingleSchema hook)
 */
export interface SingleSchema {
  slug: string;
  label: string;
  description?: string;
  fields: FieldConfig[];
  admin?: {
    group?: string;
    icon?: string;
    hidden?: boolean;
    description?: string;
  };
}

/**
 * Single document data
 */
export interface SingleDocumentData {
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface SingleFormProps {
  /** Single schema with field definitions */
  schema: SingleSchema;
  /** Current document data */
  document: SingleDocumentData;
  /** Callback when form is successfully submitted */
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Callback when form is cancelled */
  onCancel?: () => void;
  /** Custom components to inject into the form layout flow */
  headerContent?: React.ReactNode;
  /** Custom action buttons to place in the header next to the title */
  headerActions?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively extracts default values from field configurations.
 */
/** Convert camelCase to snake_case for DB column name lookup fallback. */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

function getDefaultValues(
  fields: FieldConfig[],
  existingData?: Record<string, unknown>
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  for (const field of fields) {
    if (!("name" in field) || !field.name) {
      continue;
    }

    const fieldName = field.name as string;
    // Single entry API returns DB column names (snake_case) but field configs
    // use camelCase. Try camelCase first, then fall back to snake_case.
    const existingValue =
      existingData?.[fieldName] ?? existingData?.[toSnakeCase(fieldName)];

    // Use existing value if available
    if (existingValue !== undefined) {
      // Coerce checkbox values to boolean — the database may store/return
      // them as strings ("true"/"false") or integers (0/1).
      const fieldType = field.type as string;
      if (fieldType === "checkbox" || fieldType === "boolean") {
        defaults[fieldName] =
          existingValue === true ||
          existingValue === "true" ||
          existingValue === 1;
      } else if (fieldType === "chips") {
        // Chips may be stored as a JSON string in non-JSONB databases or legacy rows.
        // Always ensure the value is an array.
        if (Array.isArray(existingValue)) {
          defaults[fieldName] = existingValue;
        } else if (typeof existingValue === "string") {
          try {
            const parsed = JSON.parse(existingValue);
            defaults[fieldName] = Array.isArray(parsed) ? parsed : [];
          } catch {
            defaults[fieldName] = [];
          }
        } else {
          defaults[fieldName] = [];
        }
      } else {
        defaults[fieldName] = existingValue;
      }
      continue;
    }

    // Generate default value based on field type
    const fieldType = field.type as string;
    switch (fieldType) {
      case "text":
      case "textarea":
      case "email":
      case "password":
      case "richText":
      case "select":
      case "radio":
        defaults[fieldName] =
          (field as { defaultValue?: string }).defaultValue ?? "";
        break;
      case "number":
        defaults[fieldName] =
          (field as { defaultValue?: number }).defaultValue ?? null;
        break;
      case "checkbox":
      case "boolean":
        defaults[fieldName] =
          (field as { defaultValue?: boolean }).defaultValue ?? false;
        break;
      case "date":
      case "time":
      case "dateTime":
        defaults[fieldName] =
          (field as { defaultValue?: string }).defaultValue ?? null;
        break;
      case "relation":
      case "relationship": {
        const relationField = field as {
          multiple?: boolean;
          hasMany?: boolean;
        };
        const isMultiple = relationField.multiple || relationField.hasMany;
        defaults[fieldName] = isMultiple ? [] : null;
        break;
      }
      case "upload": {
        const uploadField = field as { multiple?: boolean; hasMany?: boolean };
        const isMultiple = uploadField.multiple || uploadField.hasMany;
        defaults[fieldName] = isMultiple ? [] : null;
        break;
      }
      case "repeater":
      case "chips":
        defaults[fieldName] = [];
        break;
      case "group": {
        const groupField = field as { fields: FieldConfig[] };
        defaults[fieldName] = getDefaultValues(groupField.fields);
        break;
      }
      case "component": {
        const componentField = field as {
          componentFields?: FieldConfig[];
          repeatable?: boolean;
        };
        if (componentField.repeatable) {
          defaults[fieldName] = [];
        } else if (componentField.componentFields) {
          defaults[fieldName] = getDefaultValues(
            componentField.componentFields
          );
        } else {
          defaults[fieldName] = null;
        }
        break;
      }
      default:
        defaults[fieldName] = null;
    }
  }

  return defaults;
}

// ============================================================================
// Component
// ============================================================================

/**
 * SingleForm - Form for editing Single document data
 *
 * A complete form component for editing Single (Global) documents.
 * Automatically generates form fields from Single schema, handles validation
 * with Zod, and manages update operations.
 *
 * ## Features
 *
 * - Dynamic form generation from Single schema
 * - Zod validation from field configurations
 * - Two-column layout with metadata sidebar
 * - Loading and submitting states
 * - Dirty state tracking
 * - Unsaved changes protection
 * - Auto-save to localStorage
 * - Draft recovery
 * - Keyboard shortcuts (Cmd/Ctrl+S to save)
 *
 * @example
 * ```tsx
 * function SingleEditPage({ slug }: { slug: string }) {
 *   const { data: schema } = useSingleSchema(slug);
 *   const { data: document } = useSingleDocument(slug);
 *   const { mutateAsync: updateDocument, isPending } = useUpdateSingleDocument(slug);
 *
 *   if (!schema || !document) return <Skeleton />;
 *
 *   return (
 *     <SingleForm
 *       schema={schema}
 *       document={document}
 *       onSubmit={updateDocument}
 *       isSubmitting={isPending}
 *     />
 *   );
 * }
 * ```
 */
export function SingleForm({
  schema,
  document,
  onSubmit,
  isSubmitting = false,
  onCancel,
  headerContent,
  headerActions,
  className,
}: SingleFormProps) {
  // Generate Zod schema from field configurations
  const zodSchema = useMemo(() => {
    try {
      return generateClientSchema(schema.fields);
    } catch (error) {
      console.error("Failed to generate schema:", error);
      return z.record(z.string(), z.unknown());
    }
  }, [schema.fields]);

  // Generate default values from document data
  const defaultValues = useMemo(() => {
    return getDefaultValues(schema.fields, document as Record<string, unknown>);
  }, [schema.fields, document]);

  // Initialize form
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(zodSchema),
    defaultValues,
    mode: "onBlur",
  });

  // Reset form only when the actual document changes (different ID or new version).
  // Reason: defaultValues and form.reset are intentionally excluded — React Query
  // refetches produce new object references even for identical data, and including
  // the full object would reset the form mid-edit, discarding unsaved changes.
  useEffect(() => {
    if (document) {
      form.reset(defaultValues);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.id, document?.updatedAt]);

  const { errors } = form.formState;
  const isDirty = form.formState.isDirty;

  // ---------------------------------------------------------------------------
  // Auto-Save & Draft Recovery
  // ---------------------------------------------------------------------------

  const storageKey = `single-${schema.slug}`;
  const formValues = form.watch();

  const autoSave = useAutoSave({
    storageKey,
    data: formValues,
    enabled: isDirty,
    debounceMs: 2000,
  });

  const draftRecovery = useDraftRecovery({
    storageKey,
    currentData: document as Record<string, unknown>,
    onRecover: data => {
      form.reset(data);
    },
    enabled: true,
  });

  // Clear stale draft on mount if form loads clean (no draft recovery shown)
  useEffect(() => {
    if (!isDirty && !draftRecovery.showRecoveryDialog && autoSave.hasDraft) {
      autoSave.clearDraft();
    }
    // Reason: intentionally runs only on mount — checks initial state to clear
    // stale drafts; values are captured from the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Force save before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isDirty) {
        autoSave.forceSave();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty, autoSave]);

  // Clear draft when form is successfully submitted or reset
  const { clearDraft, hasDraft } = autoSave;
  useEffect(() => {
    if (!isSubmitting && !isDirty && hasDraft) {
      clearDraft();
    }
  }, [isSubmitting, isDirty, clearDraft, hasDraft]);

  // Clear draft on unmount if form is clean (no actual changes made)
  useEffect(() => {
    return () => {
      // Use a ref check or direct state access since we can't rely on captured isDirty
      const currentFormState = form.formState.isDirty;
      if (!currentFormState) {
        autoSave.clearDraft();
      }
    };
    // Reason: cleanup-only effect that must run exactly once on unmount;
    // reads live form state via form.formState rather than captured deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(
    async (e?: React.BaseSyntheticEvent) => {
      e?.preventDefault();

      await form.handleSubmit(async data => {
        try {
          await onSubmit(data);
          // Clear draft and reset form to mark as clean
          autoSave.clearDraft();
          form.reset(data);
        } catch (error) {
          console.error("Form submission error:", error);
        }
      })(e);
    },
    [form, onSubmit, autoSave]
  );

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts
  // ---------------------------------------------------------------------------

  useEntryFormShortcuts({
    onSave: handleSubmit,
    onCancel: handleCancel,
    isDirty,
    isSubmitting,
    enabled: true,
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Split fields by placement
  const allFields = schema.fields;
  const seoField = allFields.find(
    f =>
      f.name === "seo" ||
      (f.type === "group" && f.name?.toLowerCase().includes("seo"))
  );
  const slugField = allFields.find(f => f.name === "slug");
  const titleField = allFields.find(f => f.name === "title");

  const mainFields = allFields.filter(
    field =>
      field.admin?.position !== "sidebar" &&
      field.name !== "slug" &&
      field.name !== "title" &&
      field !== seoField
  );

  const sidebarFields = allFields.filter(
    field =>
      field.admin?.position === "sidebar" &&
      field.name !== "slug" &&
      field !== seoField
  );

  return (
    <UnsavedChangesGuard isDirty={isDirty} disabled={isSubmitting}>
      <div className={cn("space-y-6", className)}>
        {/* Draft Recovery Dialog */}
        {draftRecovery.draft && (
          <DraftRecoveryDialog
            open={draftRecovery.showRecoveryDialog}
            savedAt={new Date(draftRecovery.draft.savedAt)}
            onRecover={draftRecovery.recover}
            onDiscard={() => {
              draftRecovery.dismiss();
              autoSave.clearDraft();
              form.reset(defaultValues);
            }}
          />
        )}

        {/* Main Form */}
        <EntryFormProvider form={form} onSubmit={handleSubmit}>
          {/* Error summary at top of form */}
          <FormErrorSummary errors={errors} className="mb-6" />

          <div className="flex flex-col lg:flex-row lg:min-h-[calc(100vh-4rem)] items-stretch lg:-m-8">
            {/* Main Content */}
            <div className="flex-1 space-y-6 lg:p-8 pt-6">
              {headerContent}
              <SingleFormHeader
                label={schema.label}
                description={schema.description}
                updatedAt={document?.updatedAt}
                autoSave={{
                  lastSavedAt: autoSave.lastSavedAt,
                  isSaving: autoSave.isSaving,
                }}
                isDirty={isDirty}
                actions={headerActions}
              />
              {/* Custom Title & Slug row */}
              {(titleField || slugField) && (
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
            <div className="w-full lg:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-l lg:border-border bg-background flex flex-col relative z-10">
              <div className="lg:sticky lg:top-0 lg:h-[calc(100vh-4rem)] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex flex-col">
                <SingleFormSidebar
                  document={document}
                  schema={schema}
                  seoField={seoField}
                  fields={sidebarFields}
                  actions={
                    <SingleFormActions
                      isSubmitting={isSubmitting}
                      onCancel={handleCancel}
                    />
                  }
                />
              </div>
            </div>
          </div>
        </EntryFormProvider>
      </div>
    </UnsavedChangesGuard>
  );
}
