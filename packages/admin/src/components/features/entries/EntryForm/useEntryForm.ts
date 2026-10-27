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
import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { useCreateEntry } from "@admin/hooks/queries/useCreateEntry";
import { useDeleteEntry } from "@admin/hooks/queries/useDeleteEntry";
import { useDiscardWorkingDraft } from "@admin/hooks/queries/useDiscardWorkingDraft";
import { useUpdateEntry } from "@admin/hooks/queries/useUpdateEntry";
import { useAsksTranslationStatus } from "@admin/hooks/useCanRequest";
import { collectionSingularLabel } from "@admin/lib/collection-label";
import { generateClientSchema } from "@admin/lib/field-validation";
import { getDefaultValues } from "@admin/lib/form/default-values";
import {
  holdsPlaceholders,
  withoutPlaceholders,
} from "@admin/lib/form/stored-references";
import type { EntryValue } from "@admin/types/collection";

import { submitDocument } from "./submit-document";
import {
  deleteFailed,
  submitBusy,
  type DeleteOutcome,
  type SubmitOutcome,
} from "./submit-outcome";
import { useRefusedForm } from "./useRefusedForm";

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
  /** Active content locale — the update targets this language's values. */
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
  /**
   * Whether the host holds the document's writes now (it is someone else's,
   * or a past version is on screen). The host gates its own saves; this is
   * asked when a refused publish's recovery runs, which writes too. Absent,
   * writes are never held.
   */
  writesHeld?: () => boolean;
  /**
   * Called when a refused publish's recovery has saved the form as the
   * pending change, which the host counts as one of its own saves.
   */
  onRecoverySaved?: () => void;
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
 * Return type for useEntryForm hook
 */
export interface UseEntryFormReturn {
  /** React Hook Form instance */
  form: UseFormReturn<Record<string, unknown>>;
  /** Handle form submission. The optional `intent` arg names the user's
   *  action; payload shape is derived from intent. Omit for non-status
   *  collections (single Save button submits with whatever status the
   *  server already has). Resolves to what the submission came to; never
   *  rejects. */
  handleSubmit: (
    e?: React.BaseSyntheticEvent,
    intent?: EntryFormIntent
  ) => Promise<SubmitOutcome>;
  /** Delete the entry (edit mode only). Resolves to what the delete came to;
   *  never rejects. */
  handleDelete: () => Promise<DeleteOutcome>;
  /** Discard the pending working draft (draft/published split), reverting the
   *  editor to the live published row. No-op outside edit mode. Resolves once the
   *  discard succeeds and REJECTS if it fails, so the confirm dialog can show its
   *  progress until then and stay open for a retry on failure. */
  handleDiscardWorkingDraft: () => Promise<void>;
  /** Handle form cancellation */
  handleCancel: () => void;
  /** Whether form is currently submitting */
  isSubmitting: boolean;
  /**
   * Whether a refused publish's recovery is running, through to its reloaded
   * entry: the fields are read-only meanwhile.
   */
  recovering: boolean;
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
/** What makes an entry a different one for the form: see `useEntryForm`. */
interface EntryIdentity {
  id: unknown;
  version: string | null;
  /** The language and read it was loaded for, and a working draft's overlay. */
  place: string;
}

function entryIdentity(
  entry: EntryData,
  locale: string | undefined,
  readDraft: boolean | undefined
): EntryIdentity {
  return {
    id: entry.id,
    version: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
    place: JSON.stringify([
      locale ?? null,
      readDraft ?? null,
      entry._isWorkingDraft === true,
    ]),
  };
}

/**
 * How far an arriving entry resets the form. A different entry, language, read
 * or working-draft overlay starts it again; so does a new version, unless it is
 * this author's own save coming back (while the save is in flight, or matching
 * the version it stored). The same identity again — a save's own optimistic
 * copy or rollback, or newer content a working-draft save left the version of
 * unchanged — and this author's own echo both keep what is unsaved.
 */
function resetDecision(
  last: EntryIdentity | undefined,
  next: EntryIdentity,
  ownSave: { inFlight: boolean; storedVersion?: string }
): "keep-unsaved" | "full" {
  if (last === undefined) return "full";
  if (last.id !== next.id || last.place !== next.place) return "full";
  if (last.version === next.version) return "keep-unsaved";
  const ownEcho =
    ownSave.inFlight ||
    (next.version !== null && next.version === ownSave.storedVersion);
  return ownEcho ? "keep-unsaved" : "full";
}

/**
 * A reset that keeps what is unsaved: the fields the author changed keep their
 * values and every other field takes the arriving one, and the form keeps the
 * errors it shows, what was touched, and that it was submitted, so a failed
 * save's field errors and re-validation survive the rollback that follows it.
 */
const KEEP_UNSAVED = {
  keepDirtyValues: true,
  keepDirty: true,
  keepErrors: true,
  keepTouched: true,
  keepIsSubmitted: true,
  keepSubmitCount: true,
} as const;

/**
 * What the form takes in once a save is stored: normally the stored row, so a
 * value the server normalised becomes the form's starting point. The row a
 * save answers with leaves out a link the editor may not read, though, which
 * the form held as a placeholder and sent as the reference it stands for.
 * Taking that row in would drop the link from the form and the next save would
 * remove it, so when the save sent a placeholder the form keeps what it sent,
 * placeholders and all, until the page hands over the document merged with
 * its stored links again.
 */
function storedAfterSave(
  fields: FieldConfig[],
  sent: Record<string, unknown>,
  row: EntryData
): Record<string, unknown> {
  return holdsPlaceholders(fields, sent) ? sent : getDefaultValues(fields, row);
}

/** A host that holds nothing: writes are never held. */
const writesNeverHeld = () => false;
/** A host that doesn't count saves: a recovery's save goes uncounted. */
const noRecoveryCount = () => {};

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
  writesHeld = writesNeverHeld,
  onRecoverySaved = noRecoveryCount,
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

  // Reset the form to the entry when the entry changes. defaultValues is
  // useMemo'd on (fields, entry), and the query cache's structural sharing
  // hands back the same object for a refetch of identical data, so this runs
  // for changed content rather than on every keystroke or refetch. `form` is
  // a stable RHF ref.
  //
  // How far is `resetDecision`'s, on the entry's identity: its id, its stored
  // version, the language and the read it was loaded for, and whether a
  // working draft is overlaid. A save rewrites the cache without changing any
  // of those — its optimistic copy before the request, and the stored entry
  // put back (as a new object) when the request fails — and a full reset to
  // either wiped unsaved work and the errors the failure had just set. Every
  // save of a published entry's working draft also keeps the published row's
  // `updatedAt`, so a colleague's newer draft has the same identity and is told
  // apart only by its values: the untouched fields show it. The stored row
  // this author's own save puts in the cache arrives as a new version, and
  // keeps whatever they typed while the save was in flight; it is recognised
  // while the save is in flight, and afterwards by the version it stored,
  // because it can arrive on either side of the save's own reset. Any other
  // new version — a restore, a colleague's save — starts the form again from
  // it, as Restore promises when it warns unsaved work is discarded.
  // Set by a discard and cleared by the next document the page hands over;
  // see `handleDiscardWorkingDraft`.
  const [awaitingEntry, setAwaitingEntry] = useState(false);
  const resetKey = useRef<EntryIdentity | undefined>(undefined);
  const ownSave = useRef<{ inFlight: boolean; storedVersion?: string }>({
    inFlight: false,
  });

  // Password fields submit "" to mean "keep the stored hash", so they are
  // exempt from the blank-to-null normalization applied on submit.
  const blankPasswordFields = useMemo(
    () => passwordFieldNames(fields),
    [fields]
  );

  //
  // The synchronous half of the submit guard. `isSubmitting` is render state:
  // it publishes one render behind the mutation, so two submissions in the
  // same turn both read false and both write — two identical creates. The
  // latch is set the moment the first submission enters and released when it
  // settles, closing that gap. A refused publish's recovery takes it too.
  //
  const submissionLatch = useRef(false);

  // The entry as last handed over, for the recovery to start the form afresh
  // from once its reloaded entry is on screen.
  const latestDefaults = useRef(defaultValues);
  latestDefaults.current = defaultValues;

  // The form as a refused publish's way out reaches it: saved as the pending
  // change the way a status-less save sends it, then started afresh from the
  // entry that carries the live values it takes.
  const { refusedForm, recovering } = useRefusedForm(
    form,
    values =>
      withoutPlaceholders(
        fields,
        mapIntentToPayload(values, "save-working-draft", blankPasswordFields)
      ),
    {
      writesHeld,
      latch: submissionLatch,
      resetToDocument: () => form.reset(latestDefaults.current),
      saved: onRecoverySaved,
    }
  );

  useEffect(() => {
    if (!entry || mode !== "edit") return;
    const next = entryIdentity(entry, locale, readDraft);
    const decision = resetDecision(resetKey.current, next, ownSave.current);
    resetKey.current = next;
    form.reset(
      defaultValues,
      decision === "keep-unsaved" ? KEEP_UNSAVED : undefined
    );
    setAwaitingEntry(false);
  }, [entry, mode, defaultValues, form, locale, readDraft]);

  // Mutations - pass setError to enable server error mapping to form fields
  const createMutation = useCreateEntry({
    collectionSlug: collection.name,
    showToast: true,
    setError: form.setError,
  });

  // The read asks every language's translation state only of a user who may
  // read it, and the save keys its cache on the same choice.
  const asksTranslationStatus = useAsksTranslationStatus(collection.name);
  const updateMutation = useUpdateEntry({
    collectionSlug: collection.name,
    entryId: entry?.id ?? "",
    showToast: true,
    setError: form.setError,
    // For the labels a refusal over out-of-date shared fields names them by.
    fields,
    // Route the save to the active content language.
    locale,
    // Match the editor's read mode so the optimistic update, rollback, and
    // cancelQueries key onto the same cached document the form is showing. The
    // caller passes how it read the entry; absent that, assume the full-page
    // editor's mode (the working-draft overlay for a drafts collection).
    draft: readDraft ?? collection.draftsEnabled === true,
    translationStatus: asksTranslationStatus,
    refusedForm,
  });

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

  // The mutations run in parallel, so nothing downstream serialises a second
  // write against a first one still in flight — the guard has to live HERE,
  // at the one gate every submission passes through, not in the controls the
  // handler must not depend on.
  const isSubmitting =
    createMutation.isPending ||
    updateMutation.isPending ||
    discardMutation.isPending ||
    awaitingEntry;

  // The synchronous half of the same guard: `submissionLatch`, declared above
  // because a refused publish's recovery takes it too.

  // Submit handler. The intent arg names the user's button click and
  // determines payload shape (see EntryFormIntent). Without an intent,
  // submission keeps the existing status and just persists dirty fields
  // (used by the single-Save button when drafts aren't enabled).
  //
  // Resolves to what the submission came to, never rejects: the toasts and
  // field messages report to the author as before, and the outcome reports to
  // the caller, which may have to act on it (save, then open the builder).
  //
  const handleSubmit = useCallback(
    async (
      e?: React.BaseSyntheticEvent,
      intent?: EntryFormIntent
    ): Promise<SubmitOutcome> => {
      e?.preventDefault();
      if (isSubmitting || submissionLatch.current) return submitBusy;
      submissionLatch.current = true;
      // The saved row, for `onSuccess` once the form has taken it in.
      let savedRow: EntryData | undefined;
      try {
        const outcome = await submitDocument({
          form,
          event: e,
          // Why: intent → payload mapping is the core PR-3 bug fix —
          // extracted to mapIntentToPayload above so the contract is
          // unit-testable without renderHook plumbing.
          toPayload: values =>
            mapIntentToPayload(values, intent, blankPasswordFields),
          write: async data => {
            // What is sent: a link the editor cannot see is held in the form
            // as a placeholder and written as the reference it stands for.
            const payload = withoutPlaceholders(fields, data) as Record<
              string,
              EntryValue
            >;
            if (mode === "create") {
              const result = await createMutation.mutateAsync(payload);
              savedRow = result.item;
              return {
                item: result.item,
                stored: storedAfterSave(fields, data, result.item),
              };
            }
            if (!entry?.id) {
              throw new Error("Entry ID is required for update");
            }
            // entryId is passed to useUpdateEntry hook, so we just pass data here
            ownSave.current.inFlight = true;
            const result = await updateMutation
              .mutateAsync(payload)
              .finally(() => {
                ownSave.current.inFlight = false;
              });
            ownSave.current.storedVersion =
              typeof result.item.updatedAt === "string"
                ? result.item.updatedAt
                : undefined;
            savedRow = result.item;
            return {
              item: result.item,
              stored: storedAfterSave(fields, data, result.item),
            };
          },
          // Server errors are mapped to form fields through the setError the
          // mutation hooks are given; this reports the failure onwards.
          onFailure: onError,
        });
        // The entry, not the envelope: the mutation resolves to the whole
        // response so the hook can report post-commit failures, and this
        // callback's contract is the saved row.
        if (outcome.ok && savedRow !== undefined) onSuccess?.(savedRow);
        return outcome;
      } finally {
        submissionLatch.current = false;
      }
    },
    [
      form,
      mode,

      entry?.id,
      createMutation,
      updateMutation,
      isSubmitting,
      onSuccess,
      onError,
      blankPasswordFields,
      fields,
    ]
  );

  // Delete handler. Resolves once the delete has been answered, with what it
  // came to, and never rejects: the toast reports to the author as before, and
  // the outcome reports to a caller that acts on it.
  const handleDelete = useCallback(async (): Promise<DeleteOutcome> => {
    if (mode !== "edit" || !entry?.id) {
      return {
        ok: false,
        reason: "refused",
        message: "Only a saved entry can be deleted.",
      };
    }

    try {
      await deleteMutation.mutateAsync(entry.id);
      onDelete?.();
      return { ok: true };
    } catch (error) {
      console.error("Delete error:", error);
      onError?.(error);
      return deleteFailed(error);
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
    // Discard is a write like any other: the same latch the submit gate holds
    // keeps a save started in the same turn from running concurrently, whose
    // completion order would otherwise decide the working-draft state. A
    // latched call is REFUSED, not queued silently — every other path here
    // rejects so the awaiting confirm dialog stays open with its retry
    // context, and a refused discard must not close it as though it landed.
    if (isSubmitting || submissionLatch.current) {
      const latchedError = new Error(
        "A save is already in progress — wait for it to finish, then discard again."
      );
      onError?.(latchedError);
      throw latchedError;
    }
    submissionLatch.current = true;
    try {
      const result = await discardMutation.mutateAsync();
      form.reset(getDefaultValues(fields, result.item));
      // The discard answers with the live row as the API populates it, which
      // leaves out a related item the editor may not read, so a save of these
      // values would delete those links. Saving waits for the page to hand
      // over the document again, merged with its stored links.
      setAwaitingEntry(true);
    } catch (error) {
      console.error("Discard working draft error:", error);
      onError?.(error);
      // Rethrow after surfacing the error so the confirm dialog, which awaits
      // this, stays open on failure and keeps its retry context rather than
      // closing as it does on success.
      throw error;
    } finally {
      submissionLatch.current = false;
    }
  }, [isSubmitting, mode, entry?.id, discardMutation, form, fields, onError]);

  // Cancel handler
  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  return {
    form,
    handleSubmit,
    handleDelete,
    // Returned as a promise (not fire-and-forget) so the confirm dialog can
    // await the discard and keep its loading state visible until it settles.
    handleDiscardWorkingDraft: () => handleDiscardWorkingDraft(),
    handleCancel,
    isSubmitting,
    recovering,
    isDeleting: deleteMutation.isPending,
    isDirty: form.formState.isDirty,
    mode,
    collection,
    entry,
    singularLabel,
  };
}
