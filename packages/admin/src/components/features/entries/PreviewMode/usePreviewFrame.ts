"use client";

/**
 * The credentialed URL an in-admin preview frame renders, and when to re-ask.
 *
 * The frame shows the site's own draft route, which needs a signed token to
 * render a draft at all — the admin's session does not reach the site's origin.
 * That token is minted by {@link mintSelfPreview}, the same call the Preview
 * button uses, so the pane and the tab cannot disagree about the TTL, the
 * refusal mapping or what a missing site URL means.
 *
 * Two things make this more than "hold a URL":
 *
 * A frame STAYS on screen, unlike a tab that is handed a URL once and forgotten.
 * A fifteen-minute token is ample for a tab and finite for a pane left open
 * through a long edit, so the expiry is tracked and a fresh credential minted
 * before the current one lapses rather than after the frame has already failed
 * to load.
 *
 * And a reload is not a re-mint. Most refreshes happen while the token is still
 * good, and re-minting each time would issue a credential — and an audit row —
 * for something the existing one covers. Remounting the frame is the cheap path
 * and is what a save takes.
 *
 * @module components/features/entries/PreviewMode/usePreviewFrame
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  mintSelfPreview,
  type PreviewUnavailableReason,
} from "@admin/hooks/useEntryPreview";

/**
 * How close to expiry a refresh re-mints rather than reloads.
 *
 * A reload that begins before the token lapses can still arrive after it, and
 * the site answers that with the published page rather than an error — a
 * preview that silently stops being a preview. The margin buys the round trip
 * rather than expressing a preference.
 */
const REMINT_MARGIN_MS = 60_000;

export interface PreviewFrameState {
  /** The URL to render, or null while there is nothing to show. */
  url: string | null;
  /**
   * Changes on every reload, and is the frame's React key.
   *
   * A key rather than a query parameter appended to the URL: the site sees the
   * address the token names, unchanged, and the browser performs an ordinary
   * navigation. Adding a cache-buster would put an admin-invented parameter on
   * a request the SITE has to interpret, which is a contract nobody agreed.
   */
  reloadKey: number;
  /** True while a credential is being minted. */
  isLoading: boolean;
  /** Why there is nothing to show, when that is the case. */
  reason: PreviewUnavailableReason | null;
}

export interface UsePreviewFrameResult extends PreviewFrameState {
  /** Show the draft as it now stands. Re-mints only if the token is near expiry. */
  refresh: () => void;
}

/**
 * @param collection - the collection slug the entry belongs to
 * @param entryId - the SAVED entry id; the frame shows nothing without one
 * @param locale - the language to scope the token to, on a localized collection
 * @param active - whether the pane is open; nothing is minted while it is not
 */
export function usePreviewFrame({
  collection,
  entryId,
  locale,
  active,
}: {
  collection: string;
  entryId: string;
  locale?: string | undefined;
  active: boolean;
}): UsePreviewFrameResult {
  const [state, setState] = useState<PreviewFrameState>({
    url: null,
    reloadKey: 0,
    isLoading: false,
    reason: null,
  });

  /*
   * Held in a ref rather than in state because nothing renders from it: it
   * decides whether a refresh re-mints, and putting it in state would rerender
   * the frame on every mint for a value the frame never reads.
   */
  const expiresAt = useRef<number>(0);

  /*
   * Guards against a resolved mint writing over a newer one, and against
   * writing to a pane that has since closed. Two mints can be in flight when a
   * save lands while the pane is opening, and the older one must not win.
   */
  const generation = useRef(0);

  const mint = useCallback(async () => {
    const mine = ++generation.current;
    setState(prev => ({ ...prev, isLoading: true, reason: null }));

    const outcome = await mintSelfPreview(collection, entryId, locale);

    // A newer mint started, or the pane closed, while this one was in flight.
    if (mine !== generation.current) return;

    if (outcome.kind === "report") {
      expiresAt.current = 0;
      setState(prev => ({
        url: null,
        reloadKey: prev.reloadKey,
        isLoading: false,
        reason: outcome.reason,
      }));
      return;
    }

    expiresAt.current = Date.parse(outcome.expiresAt);
    setState(prev => ({
      url: outcome.url,
      reloadKey: prev.reloadKey + 1,
      isLoading: false,
      reason: null,
    }));
  }, [collection, entryId, locale]);

  // Minting is what OPENING costs, so it happens when the pane becomes active
  // rather than on mount: a closed pane issues no credential and writes no
  // audit row.
  useEffect(() => {
    if (!active) {
      // Invalidates any mint still in flight, so a pane closed mid-request does
      // not populate itself a moment after the editor dismissed it.
      generation.current += 1;
      expiresAt.current = 0;
      setState(prev => ({
        ...prev,
        url: null,
        isLoading: false,
        reason: null,
      }));
      return;
    }
    void mint();
  }, [active, mint]);

  /*
   * Renewal on a TIMER, not only when someone asks.
   *
   * A pane left open through a long edit is the case a refresh-time check
   * cannot cover: nothing calls `refresh` while an author reads, so the token
   * lapses in place and the next navigation INSIDE the frame — a link, a form,
   * anything the site itself does — arrives without a preview session and is
   * answered with the published page. Nothing announces that; the frame simply
   * stops being a preview.
   *
   * Scheduled against the margin rather than the expiry so the replacement is
   * in hand before the old one dies, and cleared on unmount so a closed pane
   * mints nothing.
   */
  useEffect(() => {
    if (!active || state.url === null) return;

    const renewIn = expiresAt.current - REMINT_MARGIN_MS - Date.now();
    /*
     * Nothing is scheduled for a token that arrives ALREADY inside the margin,
     * and that guard is not defensive — it is the difference between renewing
     * and spinning. Such a token means the configured TTL is shorter than the
     * margin, so a renewal fires at once, returns another token inside the
     * margin, and schedules the next one immediately: an unbounded mint loop,
     * each iteration issuing a credential and an audit row. A refresh still
     * re-mints on demand, which is the correct behaviour for a TTL that short.
     */
    if (renewIn <= 0) return;

    const timer = setTimeout(() => void mint(), renewIn);
    return () => clearTimeout(timer);
    // `state.url` rather than the whole state: a reload changes `reloadKey` and
    // must not restart the renewal clock, because the credential it reloads is
    // the same one and its expiry has not moved.
  }, [active, state.url, mint]);

  const refresh = useCallback(() => {
    if (!active) return;
    if (Date.now() >= expiresAt.current - REMINT_MARGIN_MS) {
      void mint();
      return;
    }
    setState(prev => ({ ...prev, reloadKey: prev.reloadKey + 1 }));
  }, [active, mint]);

  return { ...state, refresh };
}
