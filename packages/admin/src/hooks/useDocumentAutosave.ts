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
 * Kept on the server rather than in the browser, so a recovery point
 * survives a lost machine and follows the author to another browser.
 *
 * @module hooks/useDocumentAutosave
 */

import { useCallback, useEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";

import {
  lastStoredRecording,
  recordingsSent,
  recordingsSettled,
  useSnapshotAutosave,
  type AutosaveStatus,
  DEFAULT_AUTOSAVE_DEBOUNCE_MS,
} from "@admin/hooks/useSnapshotAutosave";
import { canonicalJson } from "@admin/lib/canonical-json";
import { DOCUMENT_VERSION_KEY } from "@admin/lib/document-version";
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
 * The document a recording belongs to, as the recording machinery groups it,
 * or `null` when there is none to record against.
 *
 * One spelling for every recorder of a document: the form's, and a field
 * recording its own state. A save waits for that document's recordings in
 * flight, and two spellings of one document would let it miss one.
 *
 * @param scope - the document's address, as `autosaveScopeFor` gives it
 * @returns the document's key, without its language: an author has one
 *   recovery point per document, whichever language it was recorded in
 */
export function documentRecordingKey(
  scope: VersionScope | null
): string | null {
  if (!scope) return null;
  const id = "entryId" in scope ? scope.entryId : scope.documentId;
  return `${scope.kind}:${scope.slug}:${id}`;
}

/**
 * Replace the author's recovery point with one holding no values, through the
 * same write a recording makes. A point holding no values is never offered
 * (see `useAutosaveRecovery`), so no later session or tab offers what was
 * there, and no route beyond the recording's own is needed.
 *
 * Written once the recordings already on their way have landed, so none of
 * them lands after it and puts the work back, and only if `stillWanted`
 * answers yes then: it is asked after that wait, since what it checks can
 * change during it. A write that fails leaves the point as it was, offered
 * again next time, which costs the author a second answer rather than work.
 *
 * @returns whether the point was emptied
 */
export async function emptyThePoint(
  scope: VersionScope,
  locale: string | null,
  stillWanted: () => boolean | Promise<boolean>
): Promise<boolean> {
  await recordingsSettled(documentRecordingKey(scope));
  if (!(await stillWanted())) return false;
  try {
    await versionApi.saveAutosave(scope, {}, locale);
    return true;
  } catch {
    // See above: the point stays, and is offered again.
    return false;
  }
}

/**
 * Whether the author's point still holds the recording `own` (the values this
 * recorder last stored, as JSON carries them): every value in it the one that
 * was sent. The server drops some keys before storing, such as a password,
 * but changes none. Anything else, such as newer work another tab or browser
 * of the same author recorded, is left alone, and a read that fails answers
 * no.
 */
async function holdsOwnRecording(
  scope: VersionScope,
  own: Record<string, unknown> | null
): Promise<boolean> {
  if (own === null) return false;
  try {
    const now = await versionApi.getAutosave(scope);
    if (now === null || typeof now.snapshot !== "object" || !now.snapshot) {
      return false;
    }
    return Object.entries(now.snapshot as Record<string, unknown>).every(
      ([key, value]) =>
        key in own && canonicalJson(value) === canonicalJson(own[key])
    );
  } catch {
    return false;
  }
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

  /**
   * The version the form's copy started from, recorded with each point so its
   * read can say what changed since, and a save of its restored edits is
   * judged by it.
   */
  version?: () => string | undefined;
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
  version,
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
    const startedFrom = version?.();
    const snapshot =
      startedFrom === undefined
        ? form.getValues()
        : { ...form.getValues(), [DOCUMENT_VERSION_KEY]: startedFrom };
    const stored = await versionApi.saveAutosave(scope, snapshot, locale);
    // What this recorder last stored, as the server will answer it back: see
    // `holdsOwnRecording`.
    lastStoredRef.current = JSON.parse(JSON.stringify(snapshot)) as Record<
      string,
      unknown
    >;
    return stored;
  }, [scope, form, locale, version]);

  /*
   * The identity the core keys a pending recording to.
   *
   * Built from the scope's own fields rather than passing the object: the core
   * compares identity for change, and an object rebuilt each render would look
   * like a different document every time.
   */
  const document = documentRecordingKey(scope);
  const identity = document === null ? null : `${document}:${locale ?? ""}`;

  /*
   * Whether the editor holds uncommitted changes, as the form last reported.
   * A real save resets the form, which leaves it clean: a recording asked for
   * before that would write a copy of what the save just stored.
   */
  const dirtyRef = useRef(false);
  // This recorder's last stored recording, by when and what: see `save`.
  const lastStoredRef = useRef<Record<string, unknown> | null>(null);
  // The language recordings are made in now, for an emptying decided later.
  const latestLocale = useRef(locale);
  latestLocale.current = locale;

  const { status, lastSavedAt, schedule, cancel, lastSent } =
    useSnapshotAutosave({
      identity,
      document,
      save,
      debounceMs,
      enabled,
      stillWanted: () => dirtyRef.current,
    });

  useEffect(() => {
    // Subscribed whether or not recording is enabled. A real save turns
    // recording off while it runs and resets the form when it lands: the
    // reset has to be seen to drop the recording queued before the save, and
    // a subscription that came and went with `enabled` missed exactly that
    // moment. Whether a recording is made is still decided when it fires.
    if (!scope) return;
    const recordedAs = documentRecordingKey(scope);
    // When the form last went dirty: the recordings sent by then, and the
    // stored values it held, as the form's own object (see below).
    let dirtyFrom: { sent: number; stored: unknown } | null = null;

    /*
     * The form is back to what the document stores because the author undid
     * their edits, as when typing in a field and deleting it again. A
     * recording made while it held them stays the author's recovery point,
     * and would be offered next time as unsaved work, so the point is emptied:
     * but only the point this recorder wrote. Not if it recorded nothing since
     * the form went dirty (a point waiting from a last visit, or put off with
     * Not now, is left as it was), and not if anything recorded after it, or
     * its own recording failed: a field recording its own state, such as a
     * block canvas, may hold work the form cannot see.
     */
    const emptyIfUndone = (from: number) => {
      if (recordedAs === null) return;
      void emptyThePoint(scope, latestLocale.current, async () => {
        const mine = lastSent();
        if (
          dirtyRef.current ||
          mine === null ||
          mine <= from ||
          lastStoredRecording(recordedAs) !== mine
        ) {
          return false;
        }
        // Asked of the server too: another tab or browser of the same author
        // writes the same point, and this tab cannot see its recordings.
        return holdsOwnRecording(scope, lastStoredRef.current);
      });
    };

    const subscription = form.subscribe({
      formState: { values: true, isDirty: true },
      callback: ({ isDirty, defaultValues }) => {
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
        dirtyRef.current = isDirty === true;
        // Clean again, because the work was saved for real or undone: a
        // recording still waiting for it has nothing left to protect.
        if (!isDirty) {
          cancel();
          const from = dirtyFrom;
          dirtyFrom = null;
          // Undone by changes to its fields, which leave the stored values
          // the form holds as they were. A reset installs new ones, even
          // when they read the same: a save loading what it stored (which
          // deletes the point itself), or edits kept as a point before the
          // current version is loaded over them.
          if (from !== null && from.stored === defaultValues) {
            emptyIfUndone(from.sent);
          }
          return;
        }
        if (dirtyFrom === null && recordedAs !== null) {
          dirtyFrom = {
            sent: recordingsSent(recordedAs),
            stored: defaultValues,
          };
        }
        schedule();
      },
    });

    return subscription;
    // `scope` participates through its identity fields: a different document
    // needs a different subscription, and comparing the object itself would
    // resubscribe on every render.
  }, [form, schedule, cancel, lastSent, scope?.kind, scope?.slug, scope]);
  return { status, lastSavedAt };
}
