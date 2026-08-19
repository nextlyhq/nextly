"use client";

/**
 * Records the editor's current values as the author's server-side recovery
 * point, on a debounce, while they type.
 *
 * This is NOT a save. It writes to a rolling row that only its own author can
 * read back, and it leaves the document untouched, so nothing here may make the
 * form look saved: the dirty flag stays exactly as the form set it, and the
 * unsaved-changes guard goes on firing. An autosave that cleared dirty would
 * let someone navigate away believing their work was committed.
 *
 * Distinct from `useAutoSave`, which persists to `localStorage`. That one
 * survives a crashed tab on the same machine and nothing else; this one
 * survives a lost machine, and follows the author to another browser.
 *
 * @module hooks/useDocumentAutosave
 */

import { useCallback, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";

import {
  useSnapshotAutosave,
  type AutosaveStatus,
  DEFAULT_AUTOSAVE_DEBOUNCE_MS,
} from "@admin/hooks/useSnapshotAutosave";
import { versionApi, type VersionScope } from "@admin/services/versionApi";

/**
 * The document to record against, or `null` when there is not one yet.
 *
 * Extracted as a function rather than written inline at each editor because it
 * encodes a rule that is easy to lose in a ternary: a document with no id has
 * nothing for the endpoint to address, and passing an empty or placeholder id
 * would address a document that does not exist. Both editors ask the same
 * question, and answering it twice is how the two drift apart.
 *
 * @param kind - which document family this editor edits
 * @param slug - the collection or Single slug
 * @param documentId - the SAVED id; absent while the document has never been saved
 * @returns an addressable scope, or `null` when recording must stay off
 */
export function autosaveScopeFor(
  kind: "collection" | "single",
  slug: string,
  // Accepts the absent forms rather than requiring a string, so a caller holding
  // an optional id passes it straight through. Requiring a string pushed a `??
  // ""` into every call site, which is a second place the rule is decided and
  // one the helper's own tests cannot reach.
  documentId: string | null | undefined
): VersionScope | null {
  if (!documentId || slug === "") return null;
  return kind === "single"
    ? { kind: "single", slug, documentId }
    : { kind: "collection", slug, entryId: documentId };
}

/**
 * Re-exported so the indicators that read it keep one import.
 *
 * The vocabulary belongs to the recording machinery rather than to this
 * adapter: a second editor showing a different set of words for the same four
 * states is the drift the split exists to prevent.
 */
export type { AutosaveStatus };

export interface UseDocumentAutosaveOptions {
  /**
   * The document to record against, or `null` when there is not one yet.
   *
   * A collection entry has no id until it has been created once, and the
   * endpoint addresses a document that exists, so an unsaved new entry has
   * nothing to write to. `null` disables recording rather than inventing an
   * address.
   */
  scope: VersionScope | null;

  /** The form whose values are recorded. Never mutated by this hook. */
  form: UseFormReturn<Record<string, unknown>>;

  /** The locale these values belong to, or `null` for an unlocalized document. */
  locale?: string | null;

  /** Milliseconds of quiet before a recording is made. */
  debounceMs?: number;

  /**
   * Turns recording off without unmounting. Used while a real save is in
   * flight: the document is about to change underneath the snapshot, so a
   * recovery point written now would describe a state that never existed.
   */
  enabled?: boolean;
}

export interface UseDocumentAutosaveResult {
  status: AutosaveStatus;
  /**
   * When the server stored the last recovery point, by the SERVER's clock.
   *
   * Taken from the response rather than from `Date.now()` at the call site, so
   * a "saved 2 minutes ago" reading cannot drift with an unsynchronised browser
   * clock.
   */
  lastSavedAt: Date | null;
}

/**
 * @param options - the document, the form, and how long to wait
 * @returns the current recording status and when the last one was stored
 */
export function useDocumentAutosave({
  scope,
  form,
  locale = null,
  debounceMs = DEFAULT_AUTOSAVE_DEBOUNCE_MS,
  enabled = true,
}: UseDocumentAutosaveOptions): UseDocumentAutosaveResult {
  /*
   * The snapshot, read at flush time rather than captured when the recording
   * was scheduled.
   *
   * `getValues()` reads what the form holds right now, and deliberately not
   * `handleSubmit`. Submitting runs validation and REFUSES on a failure, so a
   * recovery point would exist only for work that was already valid — which is
   * the opposite of what a recovery point is for. Half-finished input is
   * exactly what is worth not losing.
   */
  const save = useCallback(async () => {
    if (!scope) throw new Error("autosave: no scope");
    return versionApi.saveAutosave(scope, form.getValues(), locale);
  }, [scope, form, locale]);

  /*
   * The identity the core keys a pending recording to.
   *
   * Built from the scope's own fields rather than passing the object: the core
   * compares identity for change, and an object rebuilt each render would look
   * like a different document every time.
   */
  const identity = scope
    ? `${scope.kind}:${scope.slug}:${"entryId" in scope ? scope.entryId : scope.documentId}:${locale ?? ""}`
    : null;

  const { status, lastSavedAt, schedule } = useSnapshotAutosave({
    identity,
    save,
    debounceMs,
    enabled,
  });

  useEffect(() => {
    if (!enabled || !scope) return;

    const subscription = form.subscribe({
      formState: { values: true, isDirty: true },
      callback: ({ isDirty }) => {
        /*
         * Record only while the editor holds uncommitted changes.
         *
         * The discriminator is the dirty flag rather than the update's `type`.
         * `type` carries a DOM event name and is populated only when the change
         * came from a registered input's own handler: measured here, both
         * `setValue` and `reset` report it as `undefined`, so keying on
         * `"change"` would silently stop recording for every field that updates
         * programmatically, which is most non-text controls.
         *
         * Dirty also answers the case that motivated the filter. Loading a
         * document calls `reset`, which installs the loaded values as the new
         * defaults and leaves the form clean, so the page opening records
         * nothing. And it is the same condition the unsaved-changes guard uses,
         * so the two cannot disagree about whether there is work at risk.
         */
        if (!isDirty) return;
        schedule();
      },
    });

    return subscription;
    // `scope` participates through its identity fields: a different document
    // needs a different subscription, and comparing the object itself would
    // resubscribe on every render.
  }, [form, schedule, enabled, scope?.kind, scope?.slug, scope]);
  return { status, lastSavedAt };
}
