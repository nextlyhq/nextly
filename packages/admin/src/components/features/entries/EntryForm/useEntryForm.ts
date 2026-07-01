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
import type { FieldConfig } from "nextly/config";
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
  /**
   * Whether the collection has the Draft/Published status feature enabled.
   * When `true`, the entry form shows separate Save Draft / Publish buttons
   * and a status pill in the slug strip / Document panel. Backed by the
   * `dynamic_collections.status` boolean column.
   */
  status?: boolean;
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
 * Submit intent for `handleSubmit`. Each intent maps to a deterministic
 * status transition + payload shape (see `useEntryForm.handleSubmit`).
 *
 * signature couldn't distinguish "save my changes while keeping the
 * entry published" from "promote a draft to published" — both arrived
 * as `status: "published"`. The intent explicitly names the user's
 * action so the payload shape can match (e.g. `unpublish` sends only
 * `{ status: "draft" }` without other dirty fields, matching what
 * Payload's Unpublish button does).
 */
export type EntryFormIntent =
  | "save-draft"
  | "publish"
  | "save-changes"
  | "unpublish";

/**
 * Map a submit intent to the wire payload. Pure helper extracted so the
 * mapping can be unit-tested without renderHook plumbing.
 *
 * - `save-draft` / `publish`: dirty form fields plus the canonical status.
 * - `save-changes`: dirty form fields plus status="published" — the entry
 *   was already published; we re-assert the column without changing the
 *   lifecycle state.
 * - `unpublish`: status only, no other field changes. Strips any pending
 *   dirty edits so a confirm-modal misclick can't ship unrelated changes
 *   to the public site (matches the Payload pattern).
 * - undefined intent: pass `rawData` through unchanged. Used by the
 *   single-Save button when drafts aren't enabled on the collection.
 */
export function mapIntentToPayload(
  rawData: Record<string, unknown>,
  intent?: EntryFormIntent
): Record<string, unknown> {
  switch (intent) {
    case "save-draft":
      return { ...rawData, status: "draft" };
    case "publish":
      return { ...rawData, status: "published" };
    case "save-changes":
      return { ...rawData, status: "published" };
    case "unpublish":
      return { status: "draft" };
    default:
      return rawData;
  }
}

/**
 * Return type for useEntryForm hook
 */
export interface UseEntryFormReturn {
  /** React Hook Form instance */
  form: UseFormReturn<Record<string, unknown>>;
  /** Handle form submission. The optional `intent` arg names the user's
   *  action; payload shape is derived from intent. Omit for non-status
   *  collections (single Save button submits with whatever status the
   *  server already has). */
  handleSubmit: (
    e?: React.BaseSyntheticEvent,
    intent?: EntryFormIntent
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
    const fieldType = field.type as string;
    switch (fieldType) {
      case "text":
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
        // Why: richText `defaultValue` was previously hardcoded to null,
        // ignoring any developer-set value on the field config. A
        // collection that declares `richText({ name: "intro", defaultValue: ... })`
        // expects that value on every new entry. The Lexical editor handles
        // both `null` (treated as empty) and a JSON state object, so passing
        // either through is safe.
        defaults[fieldName] =
          (field as { defaultValue?: unknown }).defaultValue ?? null;
        break;

      case "json":
        // Same fix as richText — read the developer's `defaultValue`
        // instead of forcing every JSON field to null.
        defaults[fieldName] =
          (field as { defaultValue?: unknown }).defaultValue ?? null;
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
  //
  // Why mode: "onSubmit" — Mobeen flagged that the previous "onBlur"
  // setting fired field-level validation the moment a required field
  // was blurred empty (including the very common "click into title,
  // tab away" path on a fresh create page). Inline errors and the
  // top-level toast both lit up before the user had even tried to
  // save. Switching to "onSubmit" keeps the form quiet until the user
  // explicitly clicks Save / Save Draft / Publish, then RHF's default
  // `reValidateMode: "onChange"` keeps the errors in sync as the user
  // fixes them.
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onSubmit",
  });

  // Reset form only when the actual entry changes (different ID or new version).
  // Reason: defaultValues and form.reset are intentionally excluded — React Query
  // refetches produce new object references even for identical data, and including
  // the full object would reset the form mid-edit, discarding unsaved changes.
  // Reset the form when the user opens a different entry. defaultValues is
  // useMemo'd on (fields, entry), so it only changes when entry's identity
  // changes — keeps this effect from firing on every keystroke. `form` is
  // a stable RHF ref.
  useEffect(() => {
    if (entry && mode === "edit") {
      form.reset(defaultValues);
    }
  }, [entry, mode, defaultValues, form]);

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

  // Submit handler. The intent arg names the user's button click and
  // determines payload shape (see EntryFormIntent). Without an intent,
  // submission keeps the existing status and just persists dirty fields
  // (used by the single-Save button when drafts aren't enabled).
  const handleSubmit = useCallback(
    async (e?: React.BaseSyntheticEvent, intent?: EntryFormIntent) => {
      e?.preventDefault();

      await form.handleSubmit(async rawData => {
        // Why: intent → payload mapping is the core PR-3 bug fix —
        // extracted to mapIntentToPayload above so the contract is
        // unit-testable without renderHook plumbing.
        const data = mapIntentToPayload(rawData, intent);

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
