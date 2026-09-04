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
import { useDiscardWorkingDraft } from "@admin/hooks/queries/useDiscardWorkingDraft";
import { useUpdateEntry } from "@admin/hooks/queries/useUpdateEntry";
import { collectionSingularLabel } from "@admin/lib/collection-label";
import { generateClientSchema } from "@admin/lib/field-validation";
import { getDefaultValues } from "@admin/lib/form/default-values";
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
  /**
   * Whether the collection has multilingual content enabled (i18n). When `true`, text-like
   * fields are translatable by default and the entry editor exposes per-language editing.
   * Backed by the `dynamic_collections.localized` boolean column.
   */
  localized?: boolean;
  /**
   * Whether the draft/published working-draft split is enabled (drafts on a
   * versioned collection). When `true` on a `status` collection, saving an
   * already-published entry stores a pending working draft instead of writing
   * the live row; a separate Publish promotes it. Read-only, derived
   * server-side — only code-first collections enable it.
   */
  draftsEnabled?: boolean;
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
  /** Active content locale (i18n M7) — the update targets this language's values. */
  locale?: string;
  /**
   * Whether the entry was READ with the working-draft overlay (`draft`), so the
   * update's optimistic cache key matches the query the form is showing. The
   * full-page editor reads the overlay for a drafts collection; an embedded
   * editor (relationship quick-edit) reads the live row, so it must say so here
   * or its optimistic update, rollback, and `cancelQueries` would target a
   * different `detailScoped` key than the one on screen. Defaults to the
   * collection's split when unset — the full-page editor's read mode.
   */
  readDraft?: boolean;
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
  | "save-working-draft"
  | "save-changes"
  | "unpublish";

/**
 * Send a blank optional field as `null` rather than an empty string.
 *
 * An untouched optional field reaches submit as `""`, which validation accepts.
 * Persisting that literal would make "empty" mean two different things
 * depending on how the row was written — `""` from the admin, `NULL` from the
 * API or a migration — so `WHERE col IS NULL` would quietly miss rows. It also
 * breaks optional unique fields outright: `""` is a real value to a unique
 * index, so the second entry left blank collides with the first.
 *
 * `preserveBlank` names the fields that must keep their empty string. Password
 * fields rely on it: the edit form seeds them with `""` to mean "keep the
 * stored hash", which the server drops before writing, whereas `null` reads as
 * an intentional clear and would wipe the hash — or fail a required password.
 *
 * Only `""` is rewritten. `0`, `false` and `[]` are genuine values and pass
 * through untouched, as does a required field, which cannot be blank and still
 * reach this point. Nested values (groups, repeaters) are objects and are left
 * alone, so a password inside a container is unaffected either way.
 */
function blankToNull(
  data: Record<string, unknown>,
  preserveBlank?: ReadonlySet<string>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value === "" && !preserveBlank?.has(key) ? null : value,
    ])
  );
}

/**
 * Names of the top-level password fields in a field list, for `preserveBlank`.
 *
 * Only the top level is collected because that is the only level
 * `mapIntentToPayload` rewrites — a password nested in a group or repeater sits
 * inside an object value and is never touched.
 */
export function passwordFieldNames(fields: FieldConfig[]): Set<string> {
  const names = new Set<string>();
  for (const field of fields) {
    const { name, type } = field as { name?: string; type?: string };
    if (type === "password" && name) names.add(name);
  }
  return names;
}

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
 *
 * `preserveBlank` is forwarded to `blankToNull` — see there for why password
 * fields must keep their empty string.
 */
export function mapIntentToPayload(
  rawData: Record<string, unknown>,
  intent?: EntryFormIntent,
  preserveBlank?: ReadonlySet<string>
): Record<string, unknown> {
  const data = blankToNull(rawData, preserveBlank);
  switch (intent) {
    case "save-draft":
      return { ...data, status: "draft" };
    case "publish":
      return { ...data, status: "published" };
    case "save-working-draft":
      // A status-less save on a drafts-enabled, already-published entry: the
      // server stores the pending edit as a working draft and leaves the live
      // row untouched (draft/published split). Omitting `status` is exactly
      // what triggers that; a later Publish promotes the draft to live.
      return data;
    case "save-changes":
      return { ...data, status: "published" };
    case "unpublish":
      return { status: "draft" };
    default:
      return data;
  }
}

/**
 * The submit intent a plain save (the keyboard Cmd/Ctrl+S shortcut) uses for an
 * editor in a given lifecycle state, mirroring the primary Save button.
 *
 * `effectiveStatus` is the ACTIVE locale's status (from `effectiveEntryStatus`),
 * not the main row's: on a non-default language the main row carries the default
 * language's lifecycle, so keying the shortcut off it could publish or unpublish
 * the wrong translation. A published document stores a working draft on a drafts
 * collection or re-asserts published otherwise; any other state saves a draft; a
 * non-status collection has no lifecycle intent (its single Save button submits
 * without one).
 */
export function resolveDefaultSaveIntent(args: {
  mode: EntryFormMode;
  hasStatus: boolean;
  effectiveStatus: string | undefined;
  draftsEnabled: boolean;
}): EntryFormIntent | undefined {
  if (args.mode !== "edit" || !args.hasStatus) return undefined;
  if (args.effectiveStatus === "published") {
    return args.draftsEnabled ? "save-working-draft" : "save-changes";
  }
  return "save-draft";
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
  /** Discard the pending working draft (draft/published split), reverting the
   *  editor to the live published row. No-op outside edit mode. Resolves once the
   *  discard succeeds and REJECTS if it fails, so the confirm dialog can show its
   *  progress until then and stay open for a retry on failure. */
  handleDiscardWorkingDraft: () => Promise<void>;
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

/**
 * Gets the singular label for a collection.
 *
 * Delegates to the shared resolver rather than restating the fallback, so the
 * heading of this form and the shortcut that opens it name the entity
 * identically -- and keep doing so if the order ever changes.
 */
function getSingularLabel(collection: EntryFormCollection): string {
  return collectionSingularLabel(collection);
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
  locale,
  readDraft,
}: UseEntryFormOptions): UseEntryFormReturn {
  // Get fields from collection (supports both old and new API formats)
  const fields = getCollectionFields(collection);

  // Generate Zod schema from collection fields. Mode matters: password
  // fields are write-only server-side, so edit forms treat blank as "keep
  // the current password" instead of a required-field failure.
  const schema = useMemo(() => {
    try {
      return generateClientSchema(fields, { mode });
    } catch (error) {
      console.error("Failed to generate schema:", error);
      // Fallback to permissive schema
      return z.record(z.string(), z.unknown());
    }
  }, [fields, mode]);

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
    // i18n M7: route the save to the active content language.
    locale,
    // Match the editor's read mode so the optimistic update, rollback, and
    // cancelQueries key onto the same cached document the form is showing. The
    // caller passes how it read the entry; absent that, assume the full-page
    // editor's mode (the working-draft overlay for a drafts collection).
    draft: readDraft ?? collection.draftsEnabled === true,
  });

  // Password fields submit "" to mean "keep the stored hash", so they are
  // exempt from the blank-to-null normalization applied on submit.
  const blankPasswordFields = useMemo(
    () => passwordFieldNames(fields),
    [fields]
  );

  const deleteMutation = useDeleteEntry({
    collectionSlug: collection.name,
    showToast: true,
  });

  const discardMutation = useDiscardWorkingDraft({
    collectionSlug: collection.name,
    entryId: entry?.id ?? "",
    // The editor discards the language it is showing. Without this a localized
    // document's discard falls to the default language, throwing away a pending
    // change the author is not looking at and leaving the one they are.
    locale,
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
        const data = mapIntentToPayload(rawData, intent, blankPasswordFields);

        try {
          if (mode === "create") {
            const result = await createMutation.mutateAsync(
              data as Record<string, EntryValue>
            );
            // Reset form to mark as clean after successful create
            form.reset(data);
            // The entry, not the envelope: the mutation now resolves to the
            // whole response so the hook can report post-commit failures, and
            // this callback's contract is the saved row.
            onSuccess?.(result.item);
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
            onSuccess?.(result.item);
          }
        } catch (error) {
          // Server errors are automatically mapped to form fields via setError
          // passed to the mutation hooks. Only log for debugging.
          console.error("Form submission error:", error);
          onError?.(error);
        }
      })(e);
    },
    [
      form,
      mode,
      entry?.id,
      createMutation,
      updateMutation,
      onSuccess,
      onError,
      blankPasswordFields,
    ]
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

  // Discard handler (draft/published split). Throws away the pending working
  // draft and resets the editor to the live published values the discard
  // returns; the hook also invalidates the entry so the cache refetches the
  // same row. A no-op outside edit mode or before the entry exists.
  const handleDiscardWorkingDraft = useCallback(async () => {
    if (mode !== "edit" || !entry?.id) {
      return;
    }
    try {
      const result = await discardMutation.mutateAsync();
      form.reset(getDefaultValues(fields, result.item));
    } catch (error) {
      console.error("Discard working draft error:", error);
      onError?.(error);
      // Rethrow after surfacing the error so the confirm dialog, which awaits
      // this, stays open on failure and keeps its retry context rather than
      // closing as it does on success.
      throw error;
    }
  }, [mode, entry?.id, discardMutation, form, fields, onError]);

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
    // Returned as a promise (not fire-and-forget) so the confirm dialog can
    // await the discard and keep its loading state visible until it settles.
    handleDiscardWorkingDraft: () => handleDiscardWorkingDraft(),
    handleCancel,
    isSubmitting:
      createMutation.isPending ||
      updateMutation.isPending ||
      discardMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isDirty: form.formState.isDirty,
    mode,
    collection,
    entry,
    singularLabel,
  };
}
