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

import type { DocumentLockHolder } from "nextly/document-lock";
import { useRef } from "react";

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

  // 🔴 The colleague outlives a failed refresh. Every beat re-asks, so a
  // transient rejection arrives as `unavailable` long after a holder was
  // reported - and forgetting them there would hand the document to a second
  // editor while the last confirmed fact is that somebody holds an unexpired
  // lease. Cleared only by an answer that says nobody has it.
  const lastKnownHolder = useRef<DocumentLockHolder | null>(null);
  if (state.status === "held-by-other") lastKnownHolder.current = state.holder;
  else if (state.status === "held-by-me" || state.status === "idle") {
    lastKnownHolder.current = null;
  }

  return {
    ...documentLockAffordances(state, lastKnownHolder.current),
    takeOver,
  };
}
