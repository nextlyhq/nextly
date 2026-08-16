"use client";

/**
 * useAutosaveRecovery Hook
 *
 * Offers back the recovery point autosave stored, when there is one worth
 * offering.
 *
 * Without this the write half is inert: nothing else can read an autosave row.
 * History listings exclude them, and a version read addresses rows by the
 * sequence number a recovery point deliberately does not carry. A "Saved"
 * label with no path back to the snapshot promises a recovery the system
 * cannot perform, which is the failure the feature exists to prevent.
 *
 * @module hooks/useAutosaveRecovery
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { versionApi, type VersionScope } from "@admin/services/versionApi";

export interface UseAutosaveRecoveryOptions {
  /** Off while creating, and while the document has not loaded. */
  enabled: boolean;
  scope: VersionScope;
  /**
   * When the document itself was last written.
   *
   * The comparison that decides whether a recovery point is worth offering:
   * once the author saves, the document is at least as new as their autosave
   * and the snapshot describes work that is no longer missing. Using it also
   * means a consumed recovery point does not have to be deleted to stop being
   * offered, so nothing has to be cleaned up on the way out of the editor.
   */
  documentUpdatedAt: string | undefined;
}

export interface UseAutosaveRecoveryReturn {
  /** The snapshot to restore, or null when there is nothing worth offering. */
  snapshot: Record<string, unknown> | null;
  /** When that snapshot was stored. */
  savedAt: Date | null;
  /** Stop offering it for this editing session. */
  dismiss: () => void;
}

export function useAutosaveRecovery({
  enabled,
  scope,
  documentUpdatedAt,
}: UseAutosaveRecoveryOptions): UseAutosaveRecoveryReturn {
  // Read through a ref so the effect can depend on the scope's IDENTITY rather
  // than on an object literal rebuilt every render, without going stale.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(
    null
  );
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Identity of the thing being asked about, so switching document or language
  // re-asks rather than offering the previous one's snapshot.
  const scopeKey =
    scope.kind === "single"
      ? `single:${scope.slug}:${scope.documentId}`
      : `collection:${scope.slug}:${scope.entryId}`;

  useEffect(() => {
    // Drop whatever the previous scope offered before asking about this one.
    // Without this, switching document or language leaves the old offer on
    // screen when the new scope has no recovery point, and restoring it would
    // write one document's work into another.
    setSnapshot(null);
    setSavedAt(null);

    if (!enabled) return;

    // Guards the async result against a scope change mid-flight: without it a
    // slow response for the previous document could land after the editor has
    // moved on and offer its snapshot here.
    let current = true;

    void versionApi
      .getAutosave(scopeRef.current)
      .then(row => {
        if (!current || !row) return;

        const storedAt = new Date(row.updatedAt);
        const documentAt = documentUpdatedAt
          ? new Date(documentUpdatedAt)
          : null;

        // Only worth offering when it is NEWER than the saved document. An
        // autosave from before the last save describes work the author has
        // since committed, so offering it would invite them to undo it.
        if (documentAt && storedAt.getTime() <= documentAt.getTime()) return;

        setSnapshot(
          row.snapshot && typeof row.snapshot === "object"
            ? (row.snapshot as Record<string, unknown>)
            : null
        );
        setSavedAt(storedAt);
      })
      .catch(() => {
        // Nothing to offer, and nothing to say: failing to find a recovery
        // point is not an error the author asked about or can act on.
      });

    return () => {
      current = false;
    };
  }, [enabled, scopeKey, documentUpdatedAt]);

  const dismiss = useCallback(() => {
    setSnapshot(null);
    setSavedAt(null);
  }, []);

  return { snapshot, savedAt, dismiss };
}
