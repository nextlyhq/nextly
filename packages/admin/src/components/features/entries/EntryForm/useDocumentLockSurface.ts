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
  type DocumentLockChangeNotice,
  type UseDocumentLockOptions,
} from "@admin/hooks/queries/useDocumentLock";
import { useDocumentLockHolder } from "@admin/hooks/queries/useDocumentLockHolder";
import type { DocumentLatest } from "@admin/hooks/queries/useStoredReferences";
import { useCurrentUserId } from "@admin/hooks/useCurrentUserId";

import {
  documentLockAffordances,
  type HeldChangeChoice,
  readerAffordances,
  READER_LATEST_UNLOADED,
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
  /** Ask again for the latest version of the document after it failed to load. */
  readonly retryLoad: () => void;
  /**
   * Moves each time a load of the latest version of a gained document reaches
   * the screen, and at no other time; trying again after a read failed with
   * nothing gained leaves it. A view that reads its document once, as it
   * mounts, is keyed on it, so it starts again from the copy just loaded
   * rather than unlocking over the one it read before.
   */
  readonly reloads: number;
  /**
   * Someone else's change to the document this editor holds, since the
   * version its copy started from, not yet answered.
   */
  readonly change: DocumentLockChangeNotice | null;
  /** The editor has been told of `change`. */
  readonly settleChange: () => void;
  /**
   * The editor's answer to someone else's change the strip says: given by the
   * editor that says it (`withHeldChange`), absent where nothing does.
   */
  readonly answerChange?: (choice: HeldChangeChoice) => void;
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
   * kept out of it stays read-only until reads made since reach it, and one
   * whose latest read failed stays read-only until a read succeeds. Absent, a
   * gain unlocks the copy on screen at once.
   */
  latest?: DocumentLatest;
}

/** A load of the latest document, asked for on a gain or by trying again. */
interface GainLoad {
  /**
   * `answered` once the reload resolves: its reads may still be settling, or
   * be read again, before they reach the document.
   */
  readonly phase: "loading" | "answered" | "failed";
  /** When the document on screen had been read as the load was asked for. */
  readonly from: number | undefined;
  /** Which load this is, so a late answer to an earlier one changes nothing. */
  readonly attempt: number;
  /**
   * Which gain the load is for: a new one, or the one an earlier load had not
   * yet brought onto the screen when this one tried again. Null for trying
   * again after a read of a document this editor already had failed: the copy
   * on screen is then theirs, and starting the editor again would lose it.
   */
  readonly gain: number | null;
  /** The count `reloads` gave before this load reached the document. */
  readonly reachedBefore: number;
}

/**
 * Whether the document on screen is the latest one, given the gains the claim
 * has reported, the load last asked for, and whether the reads failed.
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
  // A load is about the document as it was when asked for; reads that have
  // reached the document since answer it.
  const pending =
    load !== null && latest.readAt === load.from ? load.phase : null;
  // Trying again shows as loading, though the reads still carry the failure
  // they are retrying.
  if (pending === "loading") return "loading";
  if (pending === "failed" || latest.failed) return "failed";
  // Answered, and its reads not on screen yet: still loading, unless a read
  // made since fails, which the line above has said.
  return pending === "answered" ? "loading" : "current";
}

/**
 * Load the latest document each time the claim reports a gain, and on each try
 * again, and say how far that load has got.
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
): { load: LatestDocumentLoad; retry: () => void; reloads: number } {
  const [handled, setHandled] = useState(gains);
  const [load, setLoad] = useState<GainLoad | null>(null);
  const attempts = useRef(0);
  const gainCount = useRef(0);
  const latestRef = useRef(latest);
  latestRef.current = latest;
  const loadRef = useRef(load);
  loadRef.current = load;

  const start = useCallback((gained: boolean) => {
    const reads = latestRef.current;
    if (reads === undefined) return;
    const attempt = (attempts.current += 1);
    const current = loadRef.current;
    setLoad({
      phase: "loading",
      from: reads.readAt,
      attempt,
      gain: gained ? (gainCount.current += 1) : unreachedGain(reads, current),
      reachedBefore: loadsReached(reads, current),
    });
    const settle = (phase: GainLoad["phase"]) =>
      setLoad(current =>
        current?.attempt === attempt ? { ...current, phase } : current
      );
    reads.reload().then(
      () => settle("answered"),
      () => settle("failed")
    );
  }, []);

  useEffect(() => {
    if (gains === handled) return;
    setHandled(gains);
    start(true);
  }, [gains, handled, start]);

  // A new document is a new claim, and nothing loaded for the last one
  // describes it.
  useEffect(() => {
    if (claiming) setLoad(null);
  }, [claiming]);

  return {
    load: latestLoad(latest, gains !== handled, load),
    retry: () => start(false),
    reloads: loadsReached(latest, load),
  };
}

/** Whether a load reached the document: reads made since it was asked for are on screen. */
function reached(latest: DocumentLatest | undefined, load: GainLoad): boolean {
  return latest?.readAt !== load.from;
}

/**
 * Which gain `reloads` last counted onto the screen. A load counts once its
 * reads are on screen, and only a load for a gain: trying again after a read
 * failed with nothing gained leaves the count, and the editor, as they were.
 */
function loadsReached(
  latest: DocumentLatest | undefined,
  load: GainLoad | null
): number {
  if (load === null) return 0;
  return load.gain !== null && reached(latest, load)
    ? load.gain
    : load.reachedBefore;
}

/** The gain a load that has not reached the document yet was for, if any. */
function unreachedGain(
  latest: DocumentLatest,
  load: GainLoad | null
): number | null {
  return load !== null && !reached(latest, load) ? load.gain : null;
}

/** What someone who may only read the document is shown. */
function readOnlyAffordances(
  because: "access" | "removed-from-code",
  holder: DocumentLockHolder | null | undefined,
  load: LatestDocumentLoad
): DocumentLockAffordances {
  const reader =
    because === "removed-from-code"
      ? READ_ONLY_REMOVED_FROM_CODE
      : readerAffordances(holder);
  // A reader edits nothing, so a failed read holds back nothing more than
  // they had; it is still said, since what they read may be out of date.
  return load === "failed"
    ? { ...reader, notice: READER_LATEST_UNLOADED }
    : reader;
}

export function useDocumentLockSurface({
  readOnlyForReader = false,
  readOnlyBecause = "access",
  ...options
}: DocumentLockSurfaceOptions): DocumentLockSurface {
  const enabled = options.enabled ?? true;
  const { latest, ...lockOptions } = options;
  const { state, gains, takeOver, requestAccess, change, settleChange } =
    useDocumentLock({
      ...lockOptions,
      enabled: enabled && !readOnlyForReader,
    });
  const gainLoad = useGainLoad(gains, latest, state.status === "acquiring");
  // A reader claims nothing and is told who holds the document instead.
  const holder = useDocumentLockHolder({
    ...lockOptions,
    enabled: enabled && readOnlyForReader,
  });
  // Who is signed in, so a claim held by this person in another tab is told
  // as theirs rather than as a colleague's.
  const me = useCurrentUserId();

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
      ? readOnlyAffordances(readOnlyBecause, holder, gainLoad.load)
      : documentLockAffordances(
          state,
          lastKnownHolder.current,
          gainLoad.load,
          me
        )),
    takeOver,
    requestAccess,
    retryLoad: gainLoad.retry,
    reloads: gainLoad.reloads,
    change,
    settleChange,
  };
}
