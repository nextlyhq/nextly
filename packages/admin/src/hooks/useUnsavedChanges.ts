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

/** The query without `field`, which picks a view's field and nothing else. */
function queryBesidesField(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("field");
  return params.toString();
}

/**
 * Whether a move is between one document's edit address and its own views.
 * The same page answers all of them and keeps the same form mounted, so
 * nothing unsaved is left behind. Any other query change — a language among
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
}

/** Where the guarded page is: its address, and the history entry's state. */
interface GuardedPlace {
  url: string;
  state: unknown;
}

/** The place the reader is on now. */
function currentPlace(): GuardedPlace {
  return { url: window.location.href, state: window.history.state as unknown };
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

  // Set while the traversal that completes a confirmed Back or Forward is on
  // its way, so its `popstate` is let through to the router rather than held.
  const releasing = useRef(false);

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
      if (
        pending.type === "pushState" &&
        pending.args &&
        originalPushState.current
      ) {
        originalPushState.current.apply(window.history, pending.args);
        // Dispatch locationchange event for the custom router
        window.dispatchEvent(new Event("locationchange"));
        lastLocation.current = currentPlace();
      } else if (
        pending.type === "replaceState" &&
        pending.args &&
        originalReplaceState.current
      ) {
        originalReplaceState.current.apply(window.history, pending.args);
        window.dispatchEvent(new Event("locationchange"));
        lastLocation.current = currentPlace();
      } else if (pending.type === "popstate") {
        // 🔴 Completed by traversing, not by telling the router to look. The
        // address was put back when the Back or Forward was held, on a new
        // entry just after the one the reader was going to, so one step back
        // lands there whichever way they were going. Dispatching
        // `locationchange` instead, as this once did, made the router re-read
        // the address that had been put back: the reader confirmed leaving
        // and stayed on the page, with their changes already discarded.
        releasing.current = true;
        window.history.back();
      }
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

    // Create interceptor for pushState
    // A history write let through, and the address it reached recorded.
    const passThrough = (
      write: History["pushState"],
      history: History,
      args: [data: unknown, unused: string, url?: string | URL | null]
    ): void => {
      write.apply(history, args);
      lastLocation.current = currentPlace();
    };

    const interceptPushState = function (
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null
    ) {
      // Skip interception if not dirty, navigating programmatically, or same URL
      if (!isDirty || isNavigating.current) {
        return passThrough(originalPushState.current!, this, [
          data,
          unused,
          url,
        ]);
      }

      if (!movesElsewhere(url, fieldsRef.current)) {
        // Staying put — a hash, or a rewrite of the same address.
        return passThrough(originalPushState.current!, this, [
          data,
          unused,
          url,
        ]);
      }

      // If there's already a pending navigation, ignore new attempts
      if (pendingNavigation.current) return undefined;

      // Block navigation and show dialog (avoid rapid re-open)
      pendingNavigation.current = {
        type: "pushState",
        args: [data, unused, url],
      };
      setIsBlocked(true);

      // Prevent showing the dialog repeatedly in quick succession (minimum 500ms between dialogs)
      const now = Date.now();
      if (now - lastDialogShownAt.current > 500) {
        lastDialogShownAt.current = now;
        setShowDialog(true);
      }

      // Don't actually navigate
      return undefined;
    };

    // Create interceptor for replaceState
    const interceptReplaceState = function (
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null
    ) {
      // Skip interception if not dirty or navigating programmatically
      if (!isDirty || isNavigating.current) {
        return passThrough(originalReplaceState.current!, this, [
          data,
          unused,
          url,
        ]);
      }

      if (!movesElsewhere(url, fieldsRef.current)) {
        // Staying put — a hash, or a rewrite of the same address.
        return passThrough(originalReplaceState.current!, this, [
          data,
          unused,
          url,
        ]);
      }

      // If there's already a pending navigation, ignore new attempts
      if (pendingNavigation.current) return undefined;

      // Block navigation and show dialog (avoid rapid re-open)
      pendingNavigation.current = {
        type: "replaceState",
        args: [data, unused, url],
      };
      setIsBlocked(true);

      const now = Date.now();
      if (now - lastDialogShownAt.current > 500) {
        lastDialogShownAt.current = now;
        setShowDialog(true);
      }

      return undefined;
    };

    // Handle browser back/forward.
    //
    // By the time `popstate` fires the browser has already moved the address,
    // and nothing can cancel that. So a held Back or Forward is undone: the
    // event is kept from everyone else, and the address is put back.
    const handlePopState = (event: PopStateEvent) => {
      // Where the history move came FROM: the last place this guard let the
      // page go, not the address in the bar, which has already moved.
      const from = lastLocation.current;
      // The traversal `confirmLeave` started: the reader already answered.
      if (releasing.current) {
        releasing.current = false;
        lastLocation.current = currentPlace();
        return;
      }
      if (
        !isDirty ||
        isNavigating.current ||
        // Only a hash crossed: the page stays, as a hash push does.
        !hasLeft(from) ||
        // Back or Forward between a document and its own views stays on the
        // document, exactly as a history write between them does.
        staysOnDocument(new URL(from.url), window.location, fieldsRef.current)
      ) {
        lastLocation.current = currentPlace();
        return;
      }

      // 🔴 Kept from every other listener, the admin's router above all. It
      // was mounted long before this page, so it hears `popstate` first unless
      // this listener runs in the capture phase, which on the target runs
      // before every non-capturing one. Heard, the router drew the page the
      // reader is being asked about leaving for, and this page -- its unsaved
      // work and this question -- was gone before any answer.
      event.stopImmediatePropagation();

      // 🔴 Put back with a NEW entry rather than by stepping forward with
      // `history.go(1)`, which this once did. That was right only for Back: a
      // held Forward stepped further forward. And it is native, so neither
      // the router nor this guard's own interceptor sees a navigation.
      History.prototype.pushState.call(
        window.history,
        from.state,
        "",
        from.url
      );

      // If there's already a pending navigation, ignore new popstate attempts
      if (pendingNavigation.current) return;
      pendingNavigation.current = { type: "popstate" };

      setIsBlocked(true);

      const now = Date.now();
      if (now - lastDialogShownAt.current > 500) {
        lastDialogShownAt.current = now;
        setShowDialog(true);
      }
    };

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
    window.addEventListener("popstate", handlePopState, { capture: true });
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
      window.removeEventListener("popstate", handlePopState, {
        capture: true,
      });
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
