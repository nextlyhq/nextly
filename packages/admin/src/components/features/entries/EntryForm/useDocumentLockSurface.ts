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
import { useCallback, useEffect, useRef, useState } from "react";

import {
  useDocumentLock,
  type UseDocumentLockOptions,
} from "@admin/hooks/queries/useDocumentLock";
import { useDocumentLockHolder } from "@admin/hooks/queries/useDocumentLockHolder";
import type { DocumentLatest } from "@admin/hooks/queries/useStoredReferences";

import {
  documentLockAffordances,
  readerAffordances,
  READ_ONLY_REMOVED_FROM_CODE,
  type DocumentLockAffordances,
  type LatestDocumentLoad,
} from "./document-lock-affordances";

export interface DocumentLockSurface extends DocumentLockAffordances {
  /** Claim the document, displacing whoever holds it. */
  readonly takeOver: () => void;
  /**
   * Leave word with the holder that this editor is waiting.
   *
   * The opposite intent to `takeOver` and the weakest thing here: it displaces
   * nobody, is answered by nobody, and moves no claim. A standing ask — every
   * beat re-states it until this editor has the document or leaves.
   */
  readonly requestAccess: () => void;
  /** Ask again for the latest version of a gained document that failed to load. */
  readonly retryLoad: () => void;
}

export interface DocumentLockSurfaceOptions extends UseDocumentLockOptions {
  /**
   * Whether the user may only read the document. Then no claim is made — the
   * server refuses one without the permission to change the document — and
   * the surface is read-only, with the reader's notice in the lock's place.
   * Who holds the document is still read, so the status writes a reader who
   * may publish makes wait while a colleague is editing.
   */
  readOnlyForReader?: boolean;
  /**
   * Why the surface is read-only for a reader: the user's access (the
   * default), or the entity's removal from code, whose notice the editor's
   * document banner carries instead of the reader's sentence.
   */
  readOnlyBecause?: "access" | "removed-from-code";
  /**
   * When the document on screen was read, and how to read it again: from the
   * reads that feed the form. Given, a document this editor gains after being
   * kept out of it stays read-only until reads made since reach it. Absent, a
   * gain unlocks the copy on screen at once.
   */
  latest?: DocumentLatest;
}

/** A load of the latest document, asked for when this editor gained it. */
interface GainLoad {
  readonly phase: "loading" | "failed";
  /** When the document on screen had been read as the load was asked for. */
  readonly from: number | undefined;
  /** Which load this is, so a late answer to an earlier one changes nothing. */
  readonly attempt: number;
}

/**
 * Whether the document on screen is the latest one, given the gains the claim
 * has reported and the load that the last of them asked for.
 *
 * 🔴 Answered in render, from facts in hand, and not by an effect that sets
 * "loading" after the gain: the render in between would unlock the copy read
 * while the colleague held it, and the Page Builder reads its document once,
 * as its editor mounts, so it would go on showing that copy.
 */
function latestLoad(
  latest: DocumentLatest | undefined,
  gainUnhandled: boolean,
  load: GainLoad | null
): LatestDocumentLoad {
  if (latest === undefined) return "current";
  if (gainUnhandled) return "loading";
  if (load === null || latest.readAt !== load.from) return "current";
  return load.phase;
}

/**
 * Load the latest document each time the claim reports a gain, and say how far
 * that load has got.
 *
 * 🔴 Done when the document on screen comes from reads made since the gain,
 * not when the reload answers: the answer resolves before the reads reach the
 * form, and two reads that disagree are read again before either is shown.
 * `readAt` moving is a change, not an ordering, so a clock that moves backwards
 * cannot hold the form shut.
 */
function useGainLoad(
  gains: number,
  latest: DocumentLatest | undefined,
  claiming: boolean
): { load: LatestDocumentLoad; retry: () => void } {
  const [handled, setHandled] = useState(gains);
  const [load, setLoad] = useState<GainLoad | null>(null);
  const attempts = useRef(0);
  const latestRef = useRef(latest);
  latestRef.current = latest;

  const start = useCallback(() => {
    const reads = latestRef.current;
    if (reads === undefined) return;
    const attempt = (attempts.current += 1);
    setLoad({ phase: "loading", from: reads.readAt, attempt });
    reads.reload().catch(() => {
      setLoad(current =>
        current?.attempt === attempt ? { ...current, phase: "failed" } : current
      );
    });
  }, []);

  useEffect(() => {
    if (gains === handled) return;
    setHandled(gains);
    start();
  }, [gains, handled, start]);

  // A new document is a new claim, and nothing loaded for the last one
  // describes it.
  useEffect(() => {
    if (claiming) setLoad(null);
  }, [claiming]);

  return {
    load: latestLoad(latest, gains !== handled, load),
    retry: start,
  };
}

export function useDocumentLockSurface({
  readOnlyForReader = false,
  readOnlyBecause = "access",
  ...options
}: DocumentLockSurfaceOptions): DocumentLockSurface {
  const enabled = options.enabled ?? true;
  const { latest, ...lockOptions } = options;
  const { state, gains, takeOver, requestAccess } = useDocumentLock({
    ...lockOptions,
    enabled: enabled && !readOnlyForReader,
  });
  const gainLoad = useGainLoad(gains, latest, state.status === "acquiring");
  // A reader claims nothing and is told who holds the document instead.
  const holder = useDocumentLockHolder({
    ...lockOptions,
    enabled: enabled && readOnlyForReader,
  });

  // 🔴 The colleague outlives a failed refresh. Every beat re-asks, so a
  // transient rejection arrives as `unavailable` long after a holder was
  // reported - and forgetting them there would hand the document to a second
  // editor while the last confirmed fact is that somebody holds an unexpired
  // lease. Cleared only by an answer that says nobody has it.
  const lastKnownHolder = useRef<DocumentLockHolder | null>(null);
  if (state.status === "held-by-other") lastKnownHolder.current = state.holder;
  else if (
    state.status === "held-by-me" ||
    state.status === "idle" ||
    // 🔴 And `acquiring`, which is how a NEW document announces itself. Both
    // editors reuse the mounted hook when the id changes, so carrying the last
    // document's holder into the next one renders a document read-only over a
    // colleague who was never in it. A heartbeat retry on the SAME document does
    // not pass through `acquiring`, so the holder still outlives a failed
    // refresh, which is the case this ref exists for.
    state.status === "acquiring"
  ) {
    lastKnownHolder.current = null;
  }

  return {
    ...(readOnlyForReader
      ? readOnlyBecause === "removed-from-code"
        ? READ_ONLY_REMOVED_FROM_CODE
        : readerAffordances(holder)
      : documentLockAffordances(state, lastKnownHolder.current, gainLoad.load)),
    takeOver,
    requestAccess,
    retryLoad: gainLoad.retry,
  };
}
