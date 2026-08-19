"use client";

/**
 * Record a recovery point for the document the caller is rendered inside.
 *
 * The plugin-facing way in to the same machinery the entry and Single editors
 * use. A contributed field that holds its own editing state — a block canvas, a
 * diagram, a spreadsheet — has work at risk that the form cannot see, because
 * that state is not in the form until the surface commits it. This hook lets
 * such a surface put its live state where a crash cannot take it, without
 * knowing the versions API, the debounce, or which document it is in.
 *
 * ## Why the caller supplies the WHOLE snapshot
 *
 * A recovery point is one rolling row per document per author, and restoring it
 * replaces the form's values wholesale. A surface that recorded only its own
 * field would therefore write a snapshot whose restore blanks every other field
 * in the document. So the snapshot passed here is the complete document as the
 * caller believes it stands: its own live value merged over everything else the
 * form holds.
 *
 * Doing the merge in the caller rather than here is also what keeps this hook
 * free of a form library. The admin's fields receive a `react-hook-form`
 * control, but this surface is exported to plugins, and pinning a form
 * library's types into that contract would make every future field component
 * depend on the one the admin happens to use today.
 *
 * ## Why `schedule` is called by the caller
 *
 * Only the surface knows when its state has actually changed in a way worth
 * keeping — an editor with its own undo stack has a different answer than a
 * form's dirty flag. Recording on every render would write the document opening
 * as a recovery point, which then offers the author their own unmodified
 * document back as "unsaved changes".
 *
 * @module hooks/useDocumentCheckpoint
 */

import { useCallback, useMemo, useRef } from "react";

import { useDocumentIdentity } from "@admin/components/features/entries/EntryForm/EntryFormContext";
import { useEntryLocale } from "@admin/components/features/entries/EntryLocaleContext";
import { autosaveScopeFor } from "@admin/hooks/useDocumentAutosave";
import {
  useSnapshotAutosave,
  type AutosaveStatus,
  DEFAULT_AUTOSAVE_DEBOUNCE_MS,
} from "@admin/hooks/useSnapshotAutosave";
import { versionApi } from "@admin/services/versionApi";

export interface UseDocumentCheckpointOptions {
  /**
   * The whole document as the caller believes it stands, read at flush time.
   *
   * Held in a ref and read when a recording is actually made, so the value that
   * reaches the server is the current one rather than whatever was passed when
   * the debounce started.
   */
  snapshot: Record<string, unknown>;

  /**
   * Turns recording off without unmounting.
   *
   * Not a substitute for the owner's setting, which is enforced on the server
   * and never inferred here. Use it for a moment when recording is wrong even
   * though it is allowed — while a real save is in flight, for instance, when
   * the document is about to change underneath the snapshot.
   */
  enabled?: boolean;

  /** Milliseconds of quiet before a recording is made. */
  debounceMs?: number;
}

export interface UseDocumentCheckpointResult {
  status: AutosaveStatus;
  /** When the server stored the last recording, by the SERVER's clock. */
  lastSavedAt: Date | null;
  /**
   * Ask for a recording once the debounce has elapsed.
   *
   * Safe to call from a surface that has no document to record against: with
   * nothing addressable, this does nothing rather than failing, so a caller
   * rendered in a preview or a picker needs no special case.
   */
  schedule: () => void;
}

export type { AutosaveStatus };

/**
 * @param options - the snapshot to record, and whether to record at all
 * @returns the recording status, when the last one landed, and the trigger
 */
export function useDocumentCheckpoint({
  snapshot,
  enabled = true,
  debounceMs = DEFAULT_AUTOSAVE_DEBOUNCE_MS,
}: UseDocumentCheckpointOptions): UseDocumentCheckpointResult {
  const identity = useDocumentIdentity();
  // The active content language, read here rather than asked of the caller: a
  // plugin field has no way to know it, and a recording made under the wrong
  // language would overwrite the row the form's own recording writes.
  const { locale } = useEntryLocale();

  /*
   * Memoised on the identity's own fields rather than on the identity object,
   * which `useDocumentIdentity` rebuilds each render. Without this the scope is
   * a new object every time, and everything keyed on it — the callback below,
   * and the subscription the recording machinery makes — is rebuilt with it.
   */
  const kind = identity?.kind ?? null;
  const slug = identity?.slug ?? null;
  const documentId = identity?.documentId;
  const scope = useMemo(
    () =>
      kind === null || slug === null
        ? null
        : autosaveScopeFor(kind, slug, documentId),
    [kind, slug, documentId]
  );

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const save = useCallback(async () => {
    if (!scope) throw new Error("checkpoint: no document to record against");
    return versionApi.saveAutosave(scope, snapshotRef.current, locale ?? null);
  }, [scope, locale]);

  /*
   * Keyed the same way the form's own recording is, so the two describe the
   * same document to the machinery that bounds a pending write. They write the
   * same row, and a pending recording that outlived a switch to another
   * document — or another language — would store this document's content under
   * that one's key.
   */
  const recordingKey = scope
    ? `${scope.kind}:${scope.slug}:${"entryId" in scope ? scope.entryId : scope.documentId}:${locale ?? ""}`
    : null;

  return useSnapshotAutosave({
    identity: recordingKey,
    save,
    debounceMs,
    enabled,
  });
}
