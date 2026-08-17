"use client";

/**
 * Whether to offer the author their own recovery point back when an editor
 * opens, and the values to restore if they accept.
 *
 * The other half of `useDocumentAutosave`. Recording without offering is a loop
 * that never closes: the work is stored and nobody is ever told it exists.
 *
 * @module hooks/useAutosaveRecovery
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { versionApi, type VersionScope } from "@admin/services/versionApi";

export interface UseAutosaveRecoveryOptions {
  /** The document to read a recovery point for, or `null` when there is none. */
  scope: VersionScope | null;

  /**
   * When the stored document was last written, as the API reports it.
   *
   * Used to decide whether the recovery point still says anything: a save that
   * happened after it means the author already committed that work, and
   * offering it back would invite them to restore what they are looking at.
   */
  documentUpdatedAt?: string | null;
}

export interface AutosaveRecoveryOffer {
  /** When the server stored it, for "unsaved changes from N minutes ago". */
  savedAt: Date;
  /** The values to write back into the form if the author accepts. */
  snapshot: unknown;
}

export interface UseAutosaveRecoveryResult {
  /** The offer to present, or `null` when there is nothing worth offering. */
  offer: AutosaveRecoveryOffer | null;
  /**
   * Whether the question has been answered yet.
   *
   * `offer === null` alone cannot distinguish "there is nothing to offer" from
   * "the read has not come back", and the two want different treatment: the
   * first is final, the second is a moment that will pass. Callers that render
   * on the answer need this to avoid asserting the negative early, and so does
   * any test of the suppression rules, which are otherwise satisfied by a
   * result that simply has not arrived.
   */
  isResolved: boolean;
  /**
   * Stop offering for the rest of this editing session.
   *
   * Local to the component, deliberately: it does NOT delete the stored
   * recovery point. Dismissing means "not now", and a reader who dismisses and
   * then reloads should still be offered the work rather than discovering it is
   * gone because they closed a banner.
   */
  dismiss: () => void;
}

/**
 * @param options - the document and when it was last saved
 * @returns the offer to present, and a way to stop presenting it
 */
export function useAutosaveRecovery({
  scope,
  documentUpdatedAt = null,
}: UseAutosaveRecoveryOptions): UseAutosaveRecoveryResult {
  const [dismissed, setDismissed] = useState(false);

  const { data, isPending, isError } = useQuery({
    // Keyed by the document, so switching entries asks again rather than
    // reusing the previous document's answer.
    queryKey: [
      "autosave-recovery",
      scope?.kind,
      scope?.slug,
      scope?.kind === "single" ? scope.documentId : scope?.entryId,
    ],
    queryFn: () => (scope ? versionApi.getAutosave(scope) : null),
    enabled: scope !== null,
    // Read once when the editor opens. Refetching on focus would surface an
    // offer mid-edit, and by then the form already holds newer values than the
    // recovery point does.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const dismiss = useCallback(() => setDismissed(true), []);

  // A document with no address is answered without asking: there is nothing to
  // read, and that is a final answer rather than a pending one.
  const isResolved = scope === null || isError || !isPending;

  if (dismissed || !data) return { offer: null, isResolved, dismiss };

  const savedAt = new Date(data.updatedAt);
  if (Number.isNaN(savedAt.getTime()))
    return { offer: null, isResolved, dismiss };

  // A save after the recovery point means the author already committed that
  // work, so the recovery point describes a state that is no longer ahead of
  // the document and there is nothing to rescue.
  //
  // An UNKNOWN document timestamp offers anyway. The two errors are not
  // symmetric: a spurious offer costs one dismissal, while a suppressed one
  // loses work that was recorded specifically so it could not be lost.
  if (documentUpdatedAt) {
    const documentAt = new Date(documentUpdatedAt);
    if (
      !Number.isNaN(documentAt.getTime()) &&
      savedAt.getTime() <= documentAt.getTime()
    ) {
      return { offer: null, isResolved, dismiss };
    }
  }

  return { offer: { savedAt, snapshot: data.snapshot }, isResolved, dismiss };
}
