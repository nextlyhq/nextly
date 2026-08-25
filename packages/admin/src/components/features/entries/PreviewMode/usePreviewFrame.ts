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
 * Three things make this more than "hold a URL":
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
 * And a frame is subject to two constraints a tab is not, both of which fail
 * SILENTLY by showing the published page: the browser will not carry the
 * preview cookie into a cross-origin frame, and the site holds only one preview
 * session per browser, so a second pane takes it from the first. Neither is
 * detectable from inside the frame — its document is the site's and the admin
 * cannot read it — so both are predicted here and reported as a state the pane
 * renders instead of the iframe. See {@link PreviewPaneBlock}.
 *
 * @module components/features/entries/PreviewMode/usePreviewFrame
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  mintSelfPreview,
  type PreviewUnavailableReason,
  type SelfPreviewScope,
} from "@admin/hooks/useEntryPreview";

import {
  previewScopeKey,
  watchPreviewSession,
  type PreviewSessionLock,
} from "./previewSessionLock";
import { currentAdminOrigin, isSameOriginPreview } from "./sameOriginPreview";

/**
 * How close to expiry a refresh re-mints rather than reloads.
 *
 * A reload that begins before the token lapses can still arrive after it, and
 * the site answers that with the published page rather than an error — a
 * preview that silently stops being a preview. The margin buys the round trip
 * rather than expressing a preference.
 */
const REMINT_MARGIN_MS = 60_000;

/**
 * Why a URL exists but this PANE must not render it.
 *
 * Deliberately not folded into {@link PreviewUnavailableReason}, which the
 * Preview BUTTON shares: both of these are frame-only, a tab is unaffected by
 * either, and adding them to the shared union would put reasons in the button's
 * message map that can never apply to it. The url is kept in both states so the
 * toolbar's "open in a new tab" still works — that path is exactly the remedy.
 */
export type PreviewPaneBlock = "crossOrigin" | "superseded";

export const PREVIEW_PANE_BLOCK_MESSAGES: Record<PreviewPaneBlock, string> = {
  crossOrigin:
    "The site is served from a different address than this admin, so the browser will not carry the preview session into a frame here. Open the preview in a new tab instead.",
  superseded:
    "Another preview took over this browser's preview session — the site allows one at a time. Refresh to bring it back to this pane.",
};

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
  /** Why the URL that exists cannot be framed here, when that is the case. */
  block: PreviewPaneBlock | null;
}

export interface UsePreviewFrameResult extends PreviewFrameState {
  /** Show the draft as it now stands. Re-mints only if the token is near expiry. */
  refresh: () => void;
}

/**
 * @param scope - the document to preview: a collection entry, or a Single
 * @param active - whether the pane is open; nothing is minted while it is not
 */
export function usePreviewFrame({
  scope,
  active,
}: {
  scope: SelfPreviewScope;
  active: boolean;
}): UsePreviewFrameResult {
  const [state, setState] = useState<PreviewFrameState>({
    url: null,
    reloadKey: 0,
    isLoading: false,
    reason: null,
    block: null,
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

  /*
   * The scope as a comparable VALUE, and the only dependency the mint takes.
   *
   * Callers build the scope inline, so its object identity changes on every
   * render — depending on it would re-mint a credential, and write an audit
   * row, for every keystroke in the editor beside the pane. The key changes
   * exactly when the document being previewed does.
   */
  const scopeKey = previewScopeKey(scope);

  /*
   * Kept current so the mint reads today's scope rather than the one captured
   * when the callback was last rebuilt. Without this the key and the value
   * could disagree for a render — which is the stale closure the key exists to
   * avoid, reintroduced by the fix for it.
   */
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  /*
   * The lock this pane announces through. A ref because `mint` claims through
   * it and must not be rebuilt — and therefore must not re-run the open effect
   * — every time the subscription is re-established.
   */
  const lock = useRef<PreviewSessionLock | null>(null);

  const mint = useCallback(async () => {
    const mine = ++generation.current;
    setState(prev => ({ ...prev, isLoading: true, reason: null, block: null }));

    const outcome = await mintSelfPreview(scopeRef.current);

    // A newer mint started, or the pane closed, while this one was in flight.
    if (mine !== generation.current) return;

    if (outcome.kind === "report") {
      expiresAt.current = 0;
      setState(prev => ({
        url: null,
        reloadKey: prev.reloadKey,
        isLoading: false,
        reason: outcome.reason,
        block: null,
      }));
      return;
    }

    /*
     * Judged HERE rather than when the pane opened, because this is the first
     * point the answer is knowable: the site URL sits behind a `settings`
     * permission that editors do not hold, so the admin learns where an entry
     * previews only by asking, and only when someone asks for it.
     *
     * A null admin origin (no document) counts as cross-origin. Erring toward
     * the tab is the safe direction: the tab works everywhere the pane does.
     */
    const adminOrigin = currentAdminOrigin();
    const framable =
      adminOrigin !== null && isSameOriginPreview(outcome.url, adminOrigin);

    expiresAt.current = Date.parse(outcome.expiresAt);

    /*
     * Claimed only for a frame that will actually load. A blocked pane renders
     * no iframe, so it never exchanges the token and never writes the cookie —
     * announcing a claim it did not make would evict a pane that holds a live
     * session.
     */
    if (framable) lock.current?.claim();

    setState(prev => ({
      url: outcome.url,
      reloadKey: prev.reloadKey + 1,
      isLoading: false,
      reason: null,
      block: framable ? null : "crossOrigin",
    }));
    // No dependencies: the scope is read through the ref, so this callback is
    // correct for every scope and never needs rebuilding. What must react to a
    // changed scope is the effect that OPENS the pane, and that is where the
    // key belongs — a dependency here would only be a proxy for it.
  }, []);

  /*
   * Subscribed for the whole time the pane is open, not per mint: the message
   * that matters arrives while this pane is idle, which is exactly when it is
   * not minting.
   */
  useEffect(() => {
    if (!active) return;
    const opened = watchPreviewSession(scopeKey, () => {
      setState(prev =>
        // Only a pane actually showing a frame has a session to lose. One still
        // minting will claim when its own mint resolves and win on its merits.
        prev.url === null || prev.block !== null
          ? prev
          : { ...prev, block: "superseded" }
      );
    });
    lock.current = opened;
    return () => {
      lock.current = null;
      opened.release();
    };
  }, [active, scopeKey]);

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
        block: null,
      }));
      return;
    }
    void mint();
    // `scopeKey` and not `scope`: the caller builds the scope inline, so its
    // identity changes every render and depending on it would re-mint — and
    // write an audit row — for every keystroke in the editor beside the pane.
    // The key changes exactly when the document or its language does, which is
    // exactly when a fresh credential is owed.
  }, [active, scopeKey, mint]);

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
   *
   * A BLOCKED pane schedules nothing, and that is what keeps two open panes from
   * fighting. Renewing re-claims the shared cookie, so two idle panes on a timer
   * would take the session from each other forever with nobody touching
   * anything — trading a silent failure for a noisy one. A superseded pane stays
   * dormant until an author asks for it back.
   */
  useEffect(() => {
    if (!active || state.url === null || state.block !== null) return;

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
  }, [active, state.url, state.block, mint]);

  const refresh = useCallback(() => {
    if (!active) return;
    /*
     * A blocked pane always re-mints, whatever the clock says. Reloading is
     * what a valid session takes, and a blocked pane has none: a superseded one
     * must take the cookie back, which only a mint does.
     */
    if (state.block !== null) {
      void mint();
      return;
    }
    if (Date.now() >= expiresAt.current - REMINT_MARGIN_MS) {
      void mint();
      return;
    }
    setState(prev => ({ ...prev, reloadKey: prev.reloadKey + 1 }));
  }, [active, state.block, mint]);

  return { ...state, refresh };
}
