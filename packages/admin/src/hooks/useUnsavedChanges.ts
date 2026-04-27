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
}

interface PendingNavigation {
  type: "pushState" | "replaceState" | "popstate";
  args?: [data: unknown, unused: string, url?: string | URL | null];
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
}: UseUnsavedChangesOptions): UseUnsavedChangesReturn {
  const [showDialog, setShowDialog] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  // Store pending navigation to execute after confirmation
  const pendingNavigation = useRef<PendingNavigation | null>(null);

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
      } else if (
        pending.type === "replaceState" &&
        pending.args &&
        originalReplaceState.current
      ) {
        originalReplaceState.current.apply(window.history, pending.args);
        window.dispatchEvent(new Event("locationchange"));
      } else if (pending.type === "popstate") {
        // For popstate, we need to allow the navigation that was prevented
        // The browser has already changed the URL, we just need to trigger the router
        window.dispatchEvent(new Event("locationchange"));
      }
    } finally {
      // Delay resetting the flag to prevent immediate re-interception
      setTimeout(() => {
        isNavigating.current = false;
      }, 100);
    }
  }, [onConfirmLeave]);

  // Cancel leaving - stay on page
  const cancelLeave = useCallback(() => {
    setShowDialog(false);
    setIsBlocked(false);

    const pending = pendingNavigation.current;

    // If this was a popstate (back/forward), we need to restore the URL
    if (pending?.type === "popstate" && originalPushState.current) {
      // Push the current location back to restore the URL the user was on
      isNavigating.current = true;
      try {
        // Restore the URL without triggering our interceptor
        originalPushState.current.call(
          window.history,
          null,
          "",
          window.location.href
        );
      } finally {
        isNavigating.current = false;
      }
    }

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

    // Create interceptor for pushState
    const interceptPushState = function (
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null
    ) {
      // Skip interception if not dirty, navigating programmatically, or same URL
      if (!isDirty || isNavigating.current) {
        return originalPushState.current!.apply(this, [data, unused, url]);
      }

      // Check if navigating to a different path
      const currentPath = window.location.pathname;
      const newPath = url
        ? new URL(url.toString(), window.location.origin).pathname
        : currentPath;

      if (currentPath === newPath) {
        // Same path, allow (might be query string change)
        return originalPushState.current!.apply(this, [data, unused, url]);
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
        return originalReplaceState.current!.apply(this, [data, unused, url]);
      }

      // Check if navigating to a different path
      const currentPath = window.location.pathname;
      const newPath = url
        ? new URL(url.toString(), window.location.origin).pathname
        : currentPath;

      if (currentPath === newPath) {
        // Same path, allow
        return originalReplaceState.current!.apply(this, [data, unused, url]);
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

    // Handle browser back/forward
    const handlePopState = () => {
      if (!isDirty || isNavigating.current) {
        return;
      }

      // Prevent the navigation by pushing the current state back

      // If there's already a pending navigation, ignore new popstate attempts
      if (pendingNavigation.current) return;

      // Store the pending navigation first
      pendingNavigation.current = { type: "popstate" };

      // The URL has already changed at this point, so we need to go back
      // to where we were. We'll use pushState to restore our location.
      isNavigating.current = true;
      try {
        // Go back to where we were (the URL before popstate)
        // Note: We can't reliably know where the user was going,
        // so we restore the URL they were on before
        window.history.go(1); // This might not work in all cases
      } catch {
        // If go(1) fails, try pushing current state
      } finally {
        isNavigating.current = false;
      }

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
    window.addEventListener("popstate", handlePopState);
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
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty, disabled]);

  return {
    showDialog,
    confirmLeave,
    cancelLeave,
    isBlocked,
  };
}
