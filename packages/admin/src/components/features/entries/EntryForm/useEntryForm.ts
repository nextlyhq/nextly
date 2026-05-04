"use client";

/**
 * useEntryForm Hook
 *
 * Custom hook for managing entry form state, validation, and submission.
 * Handles both create and edit modes, generating Zod schemas from collection
 * field definitions and providing submit/delete handlers.
 *
 * @module components/entries/EntryForm/useEntryForm
 * @since 1.0.0
 */

import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldConfig } from "@revnixhq/nextly/config";
import { useMemo, useCallback, useEffect } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { useCreateEntry } from "@admin/hooks/queries/useCreateEntry";
import { useDeleteEntry } from "@admin/hooks/queries/useDeleteEntry";
import { useUpdateEntry } from "@admin/hooks/queries/useUpdateEntry";
import { generateClientSchema } from "@admin/lib/field-validation";
import type { EntryValue } from "@admin/types/collection";

// ============================================================================
// Types
// ============================================================================

/**
 * Form mode - create new entry or edit existing
 */
export type EntryFormMode = "create" | "edit";

/**
 * Preview configuration for collection
 */
export interface EntryFormPreviewConfig {
  /** Function to generate preview URL from entry data (code-first) */
  url?: (entry: Record<string, unknown>) => string | null;
  /** URL template with {fieldName} placeholders (UI collections) */
  urlTemplate?: string;
  /** Whether to open preview in new tab (default: true) */
  openInNewTab?: boolean;
  /** Custom label for preview button */
  label?: string;
}

/**
 * Collection data required for form generation.
 * Supports both old API format (schemaDefinition.fields) and
 * new API format (fields directly at root).
 */
export interface EntryFormCollection {
  /** Collection slug/name for API calls */
  name: string;
  /** Slug for new API format */
  slug?: string;
  /** Display label for the collection */
  label?: string;
  /** Singular label for UI text */
  labels?: {
    singular?: string;
    plural?: string;
  };
  /**
   * Schema definition containing field configurations (legacy format).
   * New API returns fields directly at root level.
   */
  schemaDefinition?: {
    fields: FieldConfig[];
  };
  /**
   * Direct fields array (new API format).
   * Takes precedence over schemaDefinition.fields.
   */
  fields?: FieldConfig[];
  /** Admin configuration including preview settings */
  admin?: {
    preview?: EntryFormPreviewConfig;
  };
}

/**
 * Helper to get fields from a collection, supporting both old and new API formats.
 */
export function getCollectionFields(
  collection: EntryFormCollection
): FieldConfig[] {
  return collection.fields || collection.schemaDefinition?.fields || [];
}

/**
 * Entry data structure for edit mode
 */
export interface EntryData {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/**
 * Options for the useEntryForm hook
 */
export interface UseEntryFormOptions {
  /** Collection configuration with schema */
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
}

/**
 * Return type for useEntryForm hook
 */
export interface UseEntryFormReturn {
  /** React Hook Form instance */
  form: UseFormReturn<Record<string, unknown>>;
  /** Handle form submission. Optional `status` writes the canonical
   *  Draft/Published value into the mutation payload (Q-D2=A — Save Draft
   *  vs Publish split). Omit it for collections that don't have drafts
   *  enabled — the server keeps whatever status it had. */
  handleSubmit: (
    e?: React.BaseSyntheticEvent,
    status?: "draft" | "published"
  ) => Promise<void>;
  /** Handle entry deletion (edit mode only) */
  handleDelete: () => void;
  /** Handle form cancellation */
  handleCancel: () => void;
  /** Whether form is currently submitting */
  isSubmitting: boolean;
  /** Whether entry is being deleted */
  isDeleting: boolean;
  /** Whether form has unsaved changes */
  isDirty: boolean;
  /** Form mode */
  mode: EntryFormMode;
  /** Collection being edited */
  collection: EntryFormCollection;
  /** Original entry data (edit mode) */
  entry: EntryData | null;
  /** Singular label for the collection */
  singularLabel: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively extracts default values from field configurations.
 * Handles nested fields in groups and arrays.
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
    // Skip if field has no name
    if (!("name" in field) || !field.name) {
      continue;
    }

    const fieldName = field.name;
    // Entry API may return DB column names (snake_case) while field configs
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
      } else if (fieldType === "component") {
        // Component data from the API comes as an array (from
        // ComponentDataService.populateComponentData) even for
        // non-repeatable components. The form's dynamic-zone mode
        // (MultiComponentNonRepeatable) expects a single object with
        // _componentType at the top level. Unwrap single-element arrays.
        const isRepeatable = (field as { repeatable?: boolean }).repeatable;
        if (
          !isRepeatable &&
          Array.isArray(existingValue) &&
          existingValue.length === 1
        ) {
          defaults[fieldName] = existingValue[0];
        } else {
          defaults[fieldName] = existingValue;
        }
      } else {
        defaults[fieldName] = existingValue;
      }
      continue;
    }

    // Generate default value based on field type
    // Cast to string to allow legacy "string" type which isn't in the FieldConfig union
    const fieldType = field.type as string;
    switch (fieldType) {
      case "text":
      case "string": // Legacy alias - some collections store 'string' instead of 'text'
      case "textarea":
      case "email":
      case "password":
      case "code":
        defaults[fieldName] =
          (field as { defaultValue?: string }).defaultValue ?? "";
        break;

      case "number":
        defaults[fieldName] =
          (field as { defaultValue?: number }).defaultValue ?? null;
        break;

      case "checkbox":
      case "boolean": // Schema Builder alias for "checkbox"
        defaults[fieldName] =
          (field as { defaultValue?: boolean }).defaultValue ?? false;
        break;

      case "select":
      case "radio": {
        const selectField = field as {
          defaultValue?: string;
          hasMany?: boolean;
        };
        if (selectField.hasMany) {
          defaults[fieldName] = selectField.defaultValue
            ? [selectField.defaultValue]
            : [];
        } else {
          defaults[fieldName] = selectField.defaultValue ?? null;
        }
        break;
      }

      case "date":
        defaults[fieldName] =
          (field as { defaultValue?: string }).defaultValue ?? null;
        break;

      case "relationship": {
        const relField = field as { hasMany?: boolean };
        defaults[fieldName] = relField.hasMany ? [] : null;
        break;
      }

      case "upload": {
        const uploadField = field as { hasMany?: boolean };
        defaults[fieldName] = uploadField.hasMany ? [] : null;
        break;
      }

      case "repeater":
        defaults[fieldName] = [];
        break;

      case "chips": {
        const chipsField = field as { defaultValue?: string[] };
        defaults[fieldName] = chipsField.defaultValue ?? [];
        break;
      }

      case "group": {
        const groupField = field as { fields: FieldConfig[] };
        defaults[fieldName] = getDefaultValues(groupField.fields);
        break;
      }

      case "richText":
        defaults[fieldName] = null;
        break;

      case "json":
        defaults[fieldName] = null;
        break;

      case "component": {
        // Component fields: get nested defaults from componentFields
        const componentField = field as {
          componentFields?: FieldConfig[];
          repeatable?: boolean;
        };
        if (componentField.repeatable) {
          // Repeatable component: array of instances
          defaults[fieldName] = [];
        } else if (componentField.componentFields) {
          // Single component: nested object with component field defaults
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

/**
 * Gets the singular label for a collection
 */
function getSingularLabel(collection: EntryFormCollection): string {
  return collection.labels?.singular || collection.label || collection.name;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useEntryForm - Manages entry form state and operations
 *
 * Provides a complete form management solution including:
 * - Zod schema generation from collection fields
 * - Default value initialization
 * - Create and update mutations
 * - Delete operation
 * - Dirty state tracking
 *
 * @example Create mode
 * ```tsx
 * const { form, handleSubmit, isSubmitting } = useEntryForm({
 *   collection,
 *   mode: "create",
 *   onSuccess: (entry) => navigate(`/entries/${entry.id}`),
 * });
 * ```
 *
 * @example Edit mode
 * ```tsx
 * const { form, handleSubmit, handleDelete, isDirty } = useEntryForm({
 *   collection,
 *   entry: existingEntry,
 *   mode: "edit",
 *   onSuccess: () => toast.success("Entry updated"),
 *   onDelete: () => navigate("/entries"),
 * });
 * ```
 */
export function useEntryForm({
  collection,
  entry = null,
  mode,
  onSuccess,
  onError,
  onDelete,
  onCancel,
}: UseEntryFormOptions): UseEntryFormReturn {
  // Get fields from collection (supports both old and new API formats)
  const fields = getCollectionFields(collection);

  // Generate Zod schema from collection fields
  const schema = useMemo(() => {
    try {
      return generateClientSchema(fields);
    } catch (error) {
      console.error("Failed to generate schema:", error);
      // Fallback to permissive schema
      return z.record(z.string(), z.unknown());
    }
  }, [fields]);

  // Generate default values
  const defaultValues = useMemo(() => {
    const entryData = entry as Record<string, unknown> | null;
    return getDefaultValues(fields, entryData ?? undefined);
  }, [fields, entry]);

  // Initialize form
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onBlur", // Validate on blur for better UX
  });

  // Reset form only when the actual entry changes (different ID or new version).
  // Reason: defaultValues and form.reset are intentionally excluded — React Query
  // refetches produce new object references even for identical data, and including
  // the full object would reset the form mid-edit, discarding unsaved changes.
  useEffect(() => {
    if (entry && mode === "edit") {
      form.reset(defaultValues);
    }
    // We intentionally key the reset on the stable parts of `entry` so that
    // typing into a field doesn't cause the full entry object to recompute
    // and trash the user's unsaved changes. defaultValues + form omitted
    // on purpose; safe because we only reset on identity/timestamp change.
  }, [entry?.id, entry?.updatedAt, mode]);

  // Mutations - pass setError to enable server error mapping to form fields
  const createMutation = useCreateEntry({
    collectionSlug: collection.name,
    showToast: true,
    setError: form.setError,
  });

  const updateMutation = useUpdateEntry({
    collectionSlug: collection.name,
    entryId: entry?.id ?? "",
    showToast: true,
    setError: form.setError,
  });

  const deleteMutation = useDeleteEntry({
    collectionSlug: collection.name,
    showToast: true,
  });

  // Singular label for UI
  const singularLabel = getSingularLabel(collection);

  // Submit handler. The optional `status` arg lets ActionBar's Save Draft /
  // Publish buttons each write the canonical value without inventing a
  // separate mutation surface — the server treats `status` as a normal
  // field, the same way the schema-side feature wired it up.
  const handleSubmit = useCallback(
    async (e?: React.BaseSyntheticEvent, status?: "draft" | "published") => {
      e?.preventDefault();

      await form.handleSubmit(async rawData => {
        // Type assertion needed because fallback schema produces Record<string, unknown>
        // but mutations expect Record<string, EntryValue>. The actual runtime data
        // conforms to EntryValue types.
        const data = status ? { ...rawData, status } : rawData;
        try {
          if (mode === "create") {
            const result = await createMutation.mutateAsync(
              data as Record<string, EntryValue>
            );
            // Reset form to mark as clean after successful create
            form.reset(data);
            onSuccess?.(result);
          } else {
            if (!entry?.id) {
              throw new Error("Entry ID is required for update");
            }
            // entryId is passed to useUpdateEntry hook, so we just pass data here
            const result = await updateMutation.mutateAsync(
              data as Record<string, EntryValue>
            );
            // Reset form to mark as clean after successful update
            form.reset(data);
            onSuccess?.(result);
          }
        } catch (error) {
          // Server errors are automatically mapped to form fields via setError
          // passed to the mutation hooks. Only log for debugging.
          console.error("Form submission error:", error);
          onError?.(error);
        }
      })(e);
    },
    [form, mode, entry?.id, createMutation, updateMutation, onSuccess, onError]
  );

  // Delete handler
  const handleDelete = useCallback(async () => {
    if (mode !== "edit" || !entry?.id) {
      console.warn("Delete is only available in edit mode with a valid entry");
      return;
    }

    try {
      await deleteMutation.mutateAsync(entry.id);
      onDelete?.();
    } catch (error) {
      console.error("Delete error:", error);
      onError?.(error);
    }
  }, [mode, entry?.id, deleteMutation, onDelete, onError]);

  // Cancel handler
  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  return {
    form,
    handleSubmit,
    handleDelete: () => {
      void handleDelete();
    },
    handleCancel,
    isSubmitting: createMutation.isPending || updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isDirty: form.formState.isDirty,
    mode,
    collection,
    entry,
    singularLabel,
  };
}
