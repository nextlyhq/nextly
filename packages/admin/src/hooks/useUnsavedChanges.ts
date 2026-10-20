"use client";

/**
 * useUnsavedChanges Hook
 *
 * Detects unsaved form changes and blocks navigation until user confirms.
 * Works with the custom window.history-based router used in this application.
 *
 * Features:
 * - Intercepts history.pushState and history.replaceState
 * - Handles browser back/forward (popstate)
 * - Handles browser close/refresh (beforeunload)
 * - Shows confirmation dialog before discarding changes
 *
 * @module hooks/useUnsavedChanges
 * @since 1.0.0
 */

import { useEffect, useCallback, useState, useRef } from "react";

import { HISTORY_ADDRESS_PARAMS } from "@admin/components/features/versions/history-address";
import {
  drawnDocumentView,
  type DocumentKind,
} from "@admin/lib/plugins/document-view-registry";

// ============================================================================
// Types
// ============================================================================

export interface UseUnsavedChangesOptions {
  /**
   * Whether the form has unsaved changes.
   * When true, navigation will be blocked and require confirmation.
   */
  isDirty: boolean;

  /**
   * Callback fired when user confirms leaving with unsaved changes.
   * Use this to perform cleanup before navigation.
   */
  onConfirmLeave?: () => void;

  /**
   * Whether to skip the unsaved changes detection.
   * Useful for embedded forms or when explicitly disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * The edited document's fields, which decide whether a view offered on a
   * field type is drawn for it. Moving to one that is not renders not found,
   * which unmounts the form, so it is asked about like any other leave.
   */
  fields?: readonly object[] | undefined;
}

export interface UseUnsavedChangesReturn {
  /**
   * Whether the confirmation dialog should be shown.
   */
  showDialog: boolean;

  /**
   * Confirm leaving and proceed with the blocked navigation.
   */
  confirmLeave: () => void;

  /**
   * Cancel leaving and stay on the current page.
   */
  cancelLeave: () => void;

  /**
   * Whether navigation is currently blocked.
   */
  isBlocked: boolean;

  /**
   * Declare that the navigation about to happen is deliberate, so it is not
   * questioned.
   *
   * For the cases where the author has ALREADY answered this dialog's question
   * by choosing the action — discarding changes, or leaving after a save. Those
   * reset the form and navigate in the same breath, and the reset cannot reach
   * this hook before the navigation does: the interceptor reads `isDirty` from
   * the render that registered it, which is still the dirty one. So the intent
   * is stated rather than inferred from state that has not caught up.
   */
  leaveWithoutWarning: () => void;
}

/**
 * Whether the third segment of a document's address is a view the page draws
 * for this document: the answer the page gives, from the same registry and the
 * document's own fields. Anything else — a mistyped or removed view, or one
 * offered on a field type this document has no top-level field of — renders
 * another page, which unmounts the form.
 */
function isViewOf(
  kind: DocumentKind,
  slug: string,
  view: string | undefined,
  fields: readonly object[] | undefined
): boolean {
  return (
    view === undefined ||
    drawnDocumentView(kind, slug, view, fields) !== undefined
  );
}

/**
 * The document an editor address is of — an entry or a Single, on its edit
 * address or on one of its registered views — or `undefined` for any other
 * address.
 */
function documentOf(
  pathname: string,
  fields: readonly object[] | undefined
): string | undefined {
  const entry = /^\/admin\/collections\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/.exec(
    pathname
  );
  if (entry !== null) {
    const [, slug, id, view] = entry;
    if (id === "create" || !isViewOf("collection", slug, view, fields))
      return undefined;
    return JSON.stringify(["collection", slug, id]);
  }
  const single = /^\/admin\/singles\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
  if (single === null) return undefined;
  const [, slug, view] = single;
  if (!isViewOf("single", slug, view, fields)) return undefined;
  return JSON.stringify(["single", slug]);
}

/**
 * The query without the keys that move within the document: `field`, which
 * picks a view's field, and the history panel's own keys, which open history
 * beside the document and choose a version in it.
 */
function queryBesidesField(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("field");
  for (const key of HISTORY_ADDRESS_PARAMS) params.delete(key);
  return params.toString();
}

/**
 * Whether a move is between one document's edit address and its own views, or
 * opens or moves through its history beside it. The same page answers all of
 * them and keeps the same form mounted, so nothing unsaved is left behind. Any other query change — a language among
 * them — still counts, and so does another document's view.
 */
function staysOnDocument(
  from: { pathname: string; search: string },
  to: { pathname: string; search: string },
  fields: readonly object[] | undefined
): boolean {
  // The guard's fields are the current document's, which is the one the
  // move would have to stay on.
  const here = documentOf(from.pathname, fields);
  return (
    here !== undefined &&
    here === documentOf(to.pathname, fields) &&
    queryBesidesField(to.search) === queryBesidesField(from.search)
  );
}

/**
 * Whether a history write moves the reader somewhere else.
 *
 * Compares the QUERY as well as the path, because in this admin the query is
 * part of where you are rather than decoration on it: the entry editor
 * addresses its content language as `?locale=`, and switching language
 * refetches the document and discards unsaved edits exactly as leaving the page
 * would. Comparing paths alone reported that as "same place, let it through",
 * and the work went without anything asking.
 *
 * The hash is deliberately excluded. It moves within a page rather than off it.
 */
function movesElsewhere(
  url: string | URL | null | undefined,
  fields: readonly object[] | undefined
): boolean {
  if (url === undefined || url === null) return false;
  try {
    const next = new URL(url.toString(), window.location.origin);
    if (staysOnDocument(window.location, next, fields)) return false;
    return (
      next.pathname !== window.location.pathname ||
      next.search !== window.location.search
    );
  } catch {
    // An unparseable target is not something to silently allow past a guard
    // whose whole job is to stop unnoticed leaves.
    return true;
  }
}

interface PendingNavigation {
  type: "pushState" | "replaceState" | "popstate";
  args?: [data: unknown, unused: string, url?: string | URL | null];
  /**
   * For a held Back or Forward, how many entries it moved, when the browser
   * says: confirming moves the same way again. Absent where it cannot say.
   */
  steps?: number;
}

/**
 * Where the guarded page is: its address, the history entry's state, and the
 * entry's position in the session history when the browser reports one.
 */
interface GuardedPlace {
  url: string;
  state: unknown;
  index?: number;
}

/**
 * The current entry's position in the session history, from the Navigation
 * API, or `undefined` where the browser has none. Position is what tells a
 * Back from a Forward; the address alone cannot.
 */
function historyIndex(): number | undefined {
  const navigation = (
    window as { navigation?: { currentEntry?: { index: number } | null } }
  ).navigation;
  const index = navigation?.currentEntry?.index;
  return typeof index === "number" && index >= 0 ? index : undefined;
}

/** The place the reader is on now. */
function currentPlace(): GuardedPlace {
  const index = historyIndex();
  return {
    url: window.location.href,
    state: window.history.state as unknown,
    ...(index === undefined ? {} : { index }),
  };
}

/**
 * Whether the address has moved off `place`, by the same rule as a history
 * write: path or query, never the hash alone.
 */
function hasLeft(place: GuardedPlace): boolean {
  const was = new URL(place.url);
  return (
    was.pathname !== window.location.pathname ||
    was.search !== window.location.search
  );
}

/**
 * Whether a Back or Forward that arrived from `from` leaves the page: off its
 * address (not only across a hash), and not merely between a document and
 * one of its own views, which stays on the document as a history write
 * between them does.
 */
function traversalLeaves(
  from: GuardedPlace,
  fields: readonly object[] | undefined
): boolean {
  return (
    hasLeft(from) &&
    !staysOnDocument(new URL(from.url), window.location, fields)
  );
}

/**
 * Puts the page back where a held Back or Forward left from, and answers how
 * many entries the move went, or `undefined` where the browser cannot say.
 *
 * 🔴 Undone by moving back the same number of entries, in the other
 * direction, so the session history is exactly as it was: a held Back or a
 * held Forward leaves Back and Forward going where they went. Without a
 * position to go on, put back with a NEW entry instead: native, so neither
 * the router nor the guard's own interceptor sees a navigation. That gives
 * the page its address back, at the cost of the entries ahead of the
 * destination.
 */
function undoTraversal(from: GuardedPlace): number | undefined {
  const now = historyIndex();
  const steps =
    from.index === undefined || now === undefined
      ? undefined
      : now - from.index;
  if (steps !== undefined && steps !== 0) {
    window.history.go(-steps);
    return steps;
  }
  History.prototype.pushState.call(window.history, from.state, "", from.url);
  return undefined;
}

/**
 * Makes a confirmed Back or Forward again. Where the browser reported how far
 * it went, the same move in its own direction; otherwise the address was put
 * back on a new entry just after the destination, and one step back lands
 * there.
 */
function repeatTraversal(steps: number | undefined): void {
  if (steps !== undefined) window.history.go(steps);
  else window.history.back();
}

/**
 * Completes a navigation the reader confirmed, and answers whether it was a
 * history write (the page is now where it went) rather than a traversal
 * (whose own `popstate` will say).
 *
 * 🔴 A Back or Forward is completed by traversing, not by telling the router
 * to look. Dispatching `locationchange` instead, as this once did, made the
 * router re-read the address that had been put back: the reader confirmed
 * leaving and stayed on the page, with their changes already discarded.
 */
function completeNavigation(
  pending: PendingNavigation,
  writes: {
    push: History["pushState"] | null;
    replace: History["replaceState"] | null;
  }
): boolean {
  if (pending.type === "popstate") {
    repeatTraversal(pending.steps);
    return false;
  }
  const write = pending.type === "pushState" ? writes.push : writes.replace;
  if (!write || !pending.args) return false;
  completeWrite(write, pending.args);
  return true;
}

/** Completes a held history write, and tells the admin's router to look. */
function completeWrite(
  write: History["pushState"],
  args: [data: unknown, unused: string, url?: string | URL | null]
): void {
  write.apply(window.history, args);
  window.dispatchEvent(new Event("locationchange"));
}

/**
 * Holds one navigation and asks about it, or drops it.
 *
 * 🔴 A navigation is kept only together with the prompt that asks about it.
 * Kept while the prompt was suppressed -- one already open, or one shown
 * moments ago -- it waited on a question nobody was asked, and every later
 * attempt was ignored behind it. A second leave within 500ms of a prompt is
 * the same gesture arriving twice, and is dropped: the page stays where it
 * is, which is what holding it would have done.
 */
function holder(track: {
  pending: { current: PendingNavigation | null };
  lastShownAt: { current: number };
  /** Blocks the page and opens the prompt. */
  block: () => void;
}): (navigation: PendingNavigation) => void {
  return navigation => {
    if (track.pending.current) return;
    const now = Date.now();
    if (now - track.lastShownAt.current <= 500) return;
    track.lastShownAt.current = now;
    track.pending.current = navigation;
    track.block();
  };
}

/** What a history-write interceptor reads, from the hook. */
interface WriteTrack {
  isDirty: boolean;
  isNavigating: { current: boolean };
  fields: { current: readonly object[] | undefined };
  lastLocation: { current: GuardedPlace };
  hold: (navigation: PendingNavigation) => void;
}

/**
 * The interceptor that replaces one history write while the guard is on.
 *
 * One for both writes: they differ only in which write a let-through makes,
 * so two copies of the rule could only drift. A write let through records the
 * place it reached, which is what a later Back or Forward is judged from.
 */
function writeInterceptor(
  write: History["pushState"],
  kind: "pushState" | "replaceState",
  track: WriteTrack
): History["pushState"] {
  return function (
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null
  ): void {
    // Let through: nothing unsaved, a write the guard is making itself, or
    // one that stays put (a hash, or a rewrite of the same address).
    if (
      !track.isDirty ||
      track.isNavigating.current ||
      !movesElsewhere(url, track.fields.current)
    ) {
      write.apply(this, [data, unused, url]);
      track.lastLocation.current = currentPlace();
      return;
    }
    // Held, and asked about; never written.
    track.hold({ type: kind, args: [data, unused, url] });
  };
}

/**
 * A traversal the guard itself started, whose `popstate` is on its way.
 *
 * `restoring` UNDOES a held Back or Forward: its `popstate` is kept from
 * everyone, since it returns the page to where the router already believes it
 * is. `releasing` completes a confirmed one: its `popstate` is the reader's
 * answer arriving, let through to the router. One value rather than two
 * flags, because only one can be on its way at a time.
 */
type GuardTraversal = "none" | "restoring" | "releasing";

/** What the Back and Forward handler reads and moves, from the hook. */
interface PopStateTrack {
  isDirty: boolean;
  isNavigating: { current: boolean };
  /** Which traversal of the guard's own, if any, is on its way. */
  traversal: { current: GuardTraversal };
  lastLocation: { current: GuardedPlace };
  fields: { current: readonly object[] | undefined };
  hold: (navigation: PendingNavigation) => void;
}

/**
 * The guard's `popstate` handler, made from the refs it reads and moves.
 *
 * By the time `popstate` fires the browser has already moved the address,
 * and nothing can cancel that. So a held Back or Forward is undone: the
 * event is kept from everyone else, and the page is put back.
 */
function popStateHandler(track: PopStateTrack): (event: PopStateEvent) => void {
  const { isDirty, isNavigating, traversal, lastLocation } = track;
  return event => {
    // The traversal that undid a held move: back where the router thinks the
    // page is, so nobody needs to hear it.
    if (traversal.current === "restoring") {
      traversal.current = "none";
      event.stopImmediatePropagation();
      return;
    }
    // Where the history move came FROM: the last place the guard let the page
    // go, not the address in the bar, which has already moved.
    const from = lastLocation.current;
    // The traversal `confirmLeave` started (the reader already answered), or
    // a move that does not leave: where the page is now.
    if (
      traversal.current === "releasing" ||
      !isDirty ||
      isNavigating.current ||
      !traversalLeaves(from, track.fields.current)
    ) {
      traversal.current = "none";
      lastLocation.current = currentPlace();
      return;
    }

    // 🔴 Kept from every other listener, the routers above all. Heard, a
    // router draws the page the reader is being asked about leaving for, and
    // this page -- its unsaved work and this question -- is gone before any
    // answer. This handler runs ahead of them only because it is called from
    // the listener added at module load (`popStateGuards`).
    event.stopImmediatePropagation();

    const steps = undoTraversal(from);
    // The undoing traversal fires a `popstate` of its own, to be kept from
    // everyone; the new-entry put-back fires none.
    if (steps !== undefined) traversal.current = "restoring";
    track.hold(
      steps === undefined ? { type: "popstate" } : { type: "popstate", steps }
    );
  };
}

/**
 * The guards' one `popstate` listener, registered when this module loads, and
 * the handlers of the guards mounted now, in the order they mounted.
 *
 * 🔴 Registered once, at module load, rather than by each guard as it mounts.
 * In Chromium a `popstate` on `window` reaches its listeners in the order they
 * were ADDED, whatever their capture flag, so a guard that added its own
 * listener when it mounted came after the host's router, which adds its
 * listener when the app mounts. During `popstate` React renders
 * synchronously, so the router drew the page Back was going to and unmounted
 * this one, taking the guard's listener with it, before the guard was asked:
 * a Back with unsaved changes left without a word. The admin's module has to
 * load before any page can draw it, so a listener added here is ahead of every
 * router by construction.
 *
 * Kept on `globalThis` so a module evaluated again (a hot reload) reuses the
 * one listener and its list rather than adding a second.
 */
const POP_STATE_GUARDS = Symbol.for("nextly.admin.unsavedChanges.popstate");

function popStateGuards(): Array<(event: PopStateEvent) => void> {
  const holder = globalThis as unknown as Record<
    symbol,
    Array<(event: PopStateEvent) => void> | undefined
  >;
  const existing = holder[POP_STATE_GUARDS];
  if (existing) return existing;
  const guards: Array<(event: PopStateEvent) => void> = [];
  holder[POP_STATE_GUARDS] = guards;
  if (typeof window !== "undefined") {
    window.addEventListener(
      "popstate",
      event => {
        // Each mounted guard in turn, until one holds the move: holding it
        // stops the event, and nothing after should hear a held Back.
        for (const guard of [...guards]) {
          guard(event);
          if (event.cancelBubble) return;
        }
      },
      { capture: true }
    );
  }
  return guards;
}

popStateGuards();

// ============================================================================
// Hook
// ============================================================================

/**
 * useUnsavedChanges - Block navigation when form has unsaved changes
 *
 * This hook intercepts navigation attempts and shows a confirmation dialog
 * when the form is dirty. It handles:
 * - In-app navigation via history.pushState/replaceState
 * - Browser back/forward buttons via popstate
 * - Browser close/refresh via beforeunload
 *
 * @example
 * ```tsx
 * function MyForm() {
 *   const form = useForm();
 *   const { showDialog, confirmLeave, cancelLeave } = useUnsavedChanges({
 *     isDirty: form.formState.isDirty,
 *   });
 *
 *   return (
 *     <>
 *       <form>...</form>
 *       <UnsavedChangesDialog
 *         open={showDialog}
 *         onConfirm={confirmLeave}
 *         onCancel={cancelLeave}
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export function useUnsavedChanges({
  isDirty,
  onConfirmLeave,
  disabled = false,
  fields,
}: UseUnsavedChangesOptions): UseUnsavedChangesReturn {
  const [showDialog, setShowDialog] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  // Store pending navigation to execute after confirmation
  const pendingNavigation = useRef<PendingNavigation | null>(null);

  // The last place this guard let the page reach: what a Back or Forward is
  // judged FROM, since the browser has moved the address before it reports,
  // and what a held one puts back. Its address AND its history state, so the
  // entry put back is the one the reader was on.
  const lastLocation = useRef<GuardedPlace>(
    typeof window === "undefined" ? { url: "", state: null } : currentPlace()
  );

  // Read by the interceptors, which are installed once and outlive renders.
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  // Prevent rapid re-opening of the dialog (re-entrancy protection)
  const lastDialogShownAt = useRef<number>(0);

  // Store original history methods for restoration
  const originalPushState = useRef<typeof window.history.pushState | null>(
    null
  );
  const originalReplaceState = useRef<
    typeof window.history.replaceState | null
  >(null);

  // Track if we're programmatically navigating (to avoid re-interception)
  const isNavigating = useRef(false);

  // The guard's own traversal on its way, if any: see `GuardTraversal`.
  const traversal = useRef<GuardTraversal>("none");

  // Confirm leaving - execute pending navigation
  const confirmLeave = useCallback(() => {
    setShowDialog(false);
    setIsBlocked(false);
    onConfirmLeave?.();

    const pending = pendingNavigation.current;
    pendingNavigation.current = null; // Clear immediately to prevent re-entrance

    if (!pending) return;

    // Mark that we're navigating programmatically
    isNavigating.current = true;

    try {
      // A traversal's own `popstate` is the reader's answer arriving, and is
      // let through to the router.
      if (pending.type === "popstate") traversal.current = "releasing";
      const wrote = completeNavigation(pending, {
        push: originalPushState.current,
        replace: originalReplaceState.current,
      });
      if (wrote) lastLocation.current = currentPlace();
    } finally {
      // Delay resetting the flag to prevent immediate re-interception
      setTimeout(() => {
        isNavigating.current = false;
      }, 100);
    }
  }, [onConfirmLeave]);

  // Deliberate leave: suppress the next interception. The window is generous
  // because the caller navigates on the next tick or two (a form reset, a
  // mutation settling), and it closes itself so a suppression can never leak
  // into a later navigation the author did not ask for.
  const leaveWithoutWarning = useCallback(() => {
    isNavigating.current = true;
    setTimeout(() => {
      isNavigating.current = false;
    }, 500);
  }, []);

  // Cancel leaving - stay on page
  const cancelLeave = useCallback(() => {
    setShowDialog(false);
    setIsBlocked(false);
    // Answered: a new attempt is a new question, asked at once however soon
    // it comes. The spacing between prompts is for one gesture arriving
    // twice, never for the next thing the reader does.
    lastDialogShownAt.current = 0;

    // Nothing to put back for a held Back or Forward: the address was put
    // back when it was held, so staying is already where the reader is.
    pendingNavigation.current = null;
  }, []);

  useEffect(() => {
    // Skip if disabled or not dirty
    if (disabled) return;

    // Store original methods
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalPushState.current = window.history.pushState;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalReplaceState.current = window.history.replaceState;
    lastLocation.current = currentPlace();

    const hold = holder({
      pending: pendingNavigation,
      lastShownAt: lastDialogShownAt,
      block: () => {
        setIsBlocked(true);
        setShowDialog(true);
      },
    });

    const writes = {
      isDirty,
      isNavigating,
      fields: fieldsRef,
      lastLocation,
      hold,
    };
    const interceptPushState = writeInterceptor(
      originalPushState.current,
      "pushState",
      writes
    );
    const interceptReplaceState = writeInterceptor(
      originalReplaceState.current,
      "replaceState",
      writes
    );

    // Back and Forward: held and undone, `popStateHandler` says how.
    const handlePopState = popStateHandler({
      isDirty,
      isNavigating,
      traversal,
      lastLocation,
      fields: fieldsRef,
      hold,
    });

    // Handle browser close/refresh
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;

      // Standard way to show browser's native "Leave site?" dialog
      event.preventDefault();
      // Legacy support (some browsers need returnValue)
      event.returnValue = "";
      return "";
    };

    // Apply interceptors
    window.history.pushState = interceptPushState;
    window.history.replaceState = interceptReplaceState;
    // Back and Forward are heard through the one listener added at module
    // load; see `popStateGuards` for why a listener added here is too late.
    const guards = popStateGuards();
    guards.push(handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Cleanup
    return () => {
      // Restore original methods
      if (originalPushState.current) {
        window.history.pushState = originalPushState.current;
      }
      if (originalReplaceState.current) {
        window.history.replaceState = originalReplaceState.current;
      }
      const at = guards.indexOf(handlePopState);
      if (at !== -1) guards.splice(at, 1);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty, disabled]);

  return {
    showDialog,
    confirmLeave,
    cancelLeave,
    isBlocked,
    leaveWithoutWarning,
  };
}
