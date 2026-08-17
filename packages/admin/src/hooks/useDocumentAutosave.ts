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

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";

import { versionApi, type VersionScope } from "@admin/services/versionApi";

/** How long to wait after the last keystroke before recording. */
const DEFAULT_DEBOUNCE_MS = 2000;

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

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
  debounceMs = DEFAULT_DEBOUNCE_MS,
  enabled = true,
}: UseDocumentAutosaveOptions): UseDocumentAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  // Set when an edit arrives while a recording is still in flight. The values
  // that edit produced would otherwise be lost: the timer for them has already
  // fired, and no further keystroke is guaranteed to arrive to schedule another.
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);

  // Read through refs inside the debounced callback rather than captured as
  // dependencies. The callback is created once per subscription, and closing
  // over these would pin the values they held when the subscription was set up.
  const scopeRef = useRef(scope);
  const localeRef = useRef(locale);
  const enabledRef = useRef(enabled);
  scopeRef.current = scope;
  localeRef.current = locale;
  enabledRef.current = enabled;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const flush = useCallback(async () => {
    const target = scopeRef.current;
    if (!target || !enabledRef.current) return;

    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }

    inFlightRef.current = true;
    if (mountedRef.current) setStatus("saving");

    try {
      // `getValues()` reads what the form holds right now, and deliberately not
      // `handleSubmit`. Submitting runs validation and REFUSES on a failure, so
      // a recovery point would exist only for work that was already valid --
      // which is the opposite of what a recovery point is for. Half-finished
      // input is exactly what is worth not losing.
      const response = await versionApi.saveAutosave(
        target,
        form.getValues(),
        localeRef.current
      );

      if (mountedRef.current) {
        setLastSavedAt(new Date(response.updatedAt));
        setStatus("saved");
      }
    } catch {
      // Swallowed deliberately, and reported through `status` rather than
      // thrown. A recovery point nobody asked for must not surface an error
      // over the editor or interrupt typing; the next debounce tries again.
      if (mountedRef.current) setStatus("error");
    } finally {
      inFlightRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void flush();
      }
    }
  }, [form]);

  useEffect(() => {
    if (!enabled || !scope) return;

    const subscription = form.subscribe({
      formState: { values: true, isDirty: true },
      callback: ({ isDirty }) => {
        // Record only while the editor holds uncommitted changes.
        //
        // The discriminator is the dirty flag rather than the update's `type`.
        // `type` carries a DOM event name and is populated only when the change
        // came from a registered input's own handler: measured here, both
        // `setValue` and `reset` report it as `undefined`, so keying on
        // `"change"` would silently stop recording for every field that updates
        // programmatically, which is most non-text controls.
        //
        // Dirty also answers the case that motivated the filter. Loading a
        // document calls `reset`, which installs the loaded values as the new
        // defaults and leaves the form clean, so the page opening records
        // nothing. And it is the same condition the unsaved-changes guard uses,
        // so the two cannot disagree about whether there is work at risk.
        if (!isDirty) return;

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          void flush();
        }, debounceMs);
      },
    });

    return () => {
      subscription();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // `scope` participates through its identity fields: a different document
    // needs a different subscription, and comparing the object itself would
    // resubscribe on every render.
  }, [form, flush, debounceMs, enabled, scope?.kind, scope?.slug, scope]);

  return { status, lastSavedAt };
}
