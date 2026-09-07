"use client";

/**
 * The claim and what it means for the editor, as one thing.
 *
 * Both document editors need a claim AND the four decisions that follow from
 * it, and both were reaching for two pieces and joining them at the call site.
 * That is a rule spelled twice: one editor could keep the claim and drop the
 * derivation, or derive from a state it fetched differently, and the two would
 * disagree about whether a document is writable.
 *
 * @module components/features/entries/EntryForm/useDocumentLockSurface
 */

import {
  useDocumentLock,
  type UseDocumentLockOptions,
} from "@admin/hooks/queries/useDocumentLock";

import {
  documentLockAffordances,
  type DocumentLockAffordances,
} from "./document-lock-affordances";

export interface DocumentLockSurface extends DocumentLockAffordances {
  /** Claim the document, displacing whoever holds it. */
  readonly takeOver: () => void;
}

export function useDocumentLockSurface(
  options: UseDocumentLockOptions
): DocumentLockSurface {
  const { state, takeOver } = useDocumentLock(options);
  return { ...documentLockAffordances(state), takeOver };
}
