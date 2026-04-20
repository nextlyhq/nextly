/**
 * Keyboard Shortcuts Hook
 *
 * Provides keyboard shortcut handling for the admin application.
 * Includes context-specific hooks for entry list and entry form pages.
 *
 * Features:
 * - Callback ref pattern to avoid stale closures
 * - Automatic filtering of input elements
 * - Modifier key support (Ctrl, Shift, Alt, Meta)
 * - Conditional shortcut activation
 * - Repeat key prevention
 *
 * @module hooks/useKeyboardShortcuts
 * @since 1.0.0
 */

import { useEffect, useCallback, useRef, useLayoutEffect } from "react";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for a single keyboard shortcut.
 */
export interface Shortcut {
  /** The key to listen for (e.g., "n", "s", "/", "Delete", "Escape") */
  key: string;
  /** Require Ctrl key (or Cmd on Mac) */
  ctrl?: boolean;
  /** Require Shift key */
  shift?: boolean;
  /** Require Alt key (or Option on Mac) */
  alt?: boolean;
  /** Action to execute when shortcut is triggered */
  action: () => void;
  /** Human-readable description for help dialog */
  description: string;
  /** Optional condition for enabling the shortcut */
  when?: () => boolean;
}

/**
 * Options for the useKeyboardShortcuts hook.
 */
export interface UseKeyboardShortcutsOptions {
  /** Whether shortcuts are enabled (default: true) */
  enabled?: boolean;
  /** Allow shortcuts to fire repeatedly when key is held (default: false) */
  allowRepeat?: boolean;
}

/**
 * Options for entry list shortcuts.
 */
export interface EntryListShortcutsOptions {
  /** Handler for creating a new entry */
  onNew: () => void;
  /** Handler for focusing search input */
  onSearch: () => void;
  /** Handler for selecting all entries */
  onSelectAll: () => void;
  /** Handler for deleting selected entries */
  onDelete: () => void;

  /** Whether there are entries selected */
  hasSelection: boolean;
  /** Whether shortcuts are enabled */
  enabled?: boolean;
}

/**
 * Options for entry form shortcuts.
 */
export interface EntryFormShortcutsOptions {
  /** Handler for saving the entry */
  onSave: () => void;
  /** Handler for canceling and going back */
  onCancel: () => void;

  /** Whether the form has unsaved changes */
  isDirty: boolean;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Whether shortcuts are enabled */
  enabled?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if the event target is a text input element.
 * Shortcuts should not fire when the user is typing.
 */
function isTextInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toUpperCase();

  // Check for input fields (except buttons and checkboxes)
  if (tagName === "INPUT") {
    const inputType = (target as HTMLInputElement).type?.toLowerCase();
    const nonTextInputTypes = [
      "button",
      "submit",
      "reset",
      "checkbox",
      "radio",
      "file",
      "image",
      "hidden",
    ];
    return !nonTextInputTypes.includes(inputType);
  }

  // Check for textarea and contentEditable
  if (tagName === "TEXTAREA") {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  return false;
}

/**
 * Check if the key matches, handling case-insensitivity for letter keys.
 */
function keyMatches(eventKey: string, shortcutKey: string): boolean {
  // Handle special keys exactly
  if (shortcutKey.length > 1) {
    return eventKey === shortcutKey;
  }

  // Handle letter keys case-insensitively
  return eventKey.toLowerCase() === shortcutKey.toLowerCase();
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Hook for registering and handling keyboard shortcuts.
 *
 * Uses the callback ref pattern to avoid stale closure issues without
 * requiring consumers to memoize their callbacks.
 *
 * @param shortcuts - Array of shortcut configurations
 * @param options - Hook options
 *
 * @example
 * ```tsx
 * useKeyboardShortcuts([
 *   {
 *     key: "s",
 *     ctrl: true,
 *     action: handleSave,
 *     description: "Save entry",
 *   },
 *   {
 *     key: "Escape",
 *     action: handleCancel,
 *     description: "Cancel and go back",
 *   },
 * ]);
 * ```
 */
export function useKeyboardShortcuts(
  shortcuts: Shortcut[],
  options: UseKeyboardShortcutsOptions = {}
): void {
  const { enabled = true, allowRepeat = false } = options;

  // Use callback ref pattern to always have fresh references
  const shortcutsRef = useRef(shortcuts);
  useLayoutEffect(() => {
    shortcutsRef.current = shortcuts;
  });

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when disabled
      if (!enabled) {
        return;
      }

      // Don't trigger shortcuts when typing in text inputs
      if (isTextInputElement(event.target)) {
        return;
      }

      // Don't trigger on repeated key events (key held down) unless allowed
      if (event.repeat && !allowRepeat) {
        return;
      }

      const currentShortcuts = shortcutsRef.current;

      for (const shortcut of currentShortcuts) {
        // Check key match
        if (!keyMatches(event.key, shortcut.key)) {
          continue;
        }

        // Check modifier keys
        // Support both Ctrl and Cmd (Meta) for cross-platform compatibility
        const ctrlMatch = shortcut.ctrl
          ? event.ctrlKey || event.metaKey
          : !event.ctrlKey && !event.metaKey;
        const shiftMatch = !!shortcut.shift === event.shiftKey;
        const altMatch = !!shortcut.alt === event.altKey;

        if (!ctrlMatch || !shiftMatch || !altMatch) {
          continue;
        }

        // Check conditional activation
        if (shortcut.when && !shortcut.when()) {
          continue;
        }

        // All conditions met - execute the action
        event.preventDefault();
        event.stopPropagation();
        shortcut.action();
        return;
      }
    },
    [enabled, allowRepeat]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown, enabled]);
}

// ============================================================================
// Context-Specific Hooks
// ============================================================================

/**
 * Keyboard shortcuts for the entry list page.
 *
 * Shortcuts:
 * - Ctrl+N: Create new entry
 * - /: Focus search
 * - Ctrl+A: Select all entries
 * - Delete: Delete selected entries (when has selection)
 * - ?: Show keyboard shortcuts help
 *
 * @param options - Entry list shortcut options
 *
 * @example
 * ```tsx
 * useEntryListShortcuts({
 *   onNew: () => navigate("/create"),
 *   onSearch: () => searchInputRef.current?.focus(),
 *   onSelectAll: () => table.toggleAllRowsSelected(true),
 *   onDelete: () => setDeleteDialogOpen(true),
 *   onShowHelp: () => setHelpOpen(true),
 *   hasSelection: selectedRows.length > 0,
 * });
 * ```
 */
export function useEntryListShortcuts({
  onNew,
  onSearch,
  onSelectAll,
  onDelete,
  hasSelection,
  enabled = true,
}: EntryListShortcutsOptions): void {
  // Store hasSelection in ref to avoid stale closure
  const hasSelectionRef = useRef(hasSelection);
  useLayoutEffect(() => {
    hasSelectionRef.current = hasSelection;
  });

  const shortcuts: Shortcut[] = [
    {
      key: "n",
      ctrl: true,
      action: onNew,
      description: "Create new entry",
    },
    {
      key: "/",
      action: onSearch,
      description: "Focus search",
    },
    {
      key: "a",
      ctrl: true,
      action: onSelectAll,
      description: "Select all entries",
    },
    {
      key: "Delete",
      action: onDelete,
      description: "Delete selected entries",
      when: () => hasSelectionRef.current,
    },
  ];

  useKeyboardShortcuts(shortcuts, { enabled });
}

/**
 * Keyboard shortcuts for the entry form page.
 *
 * Shortcuts:
 * - Ctrl+S: Save entry (when form is dirty and not submitting)
 * - Escape: Cancel and go back
 * - ?: Show keyboard shortcuts help
 *
 * @param options - Entry form shortcut options
 *
 * @example
 * ```tsx
 * useEntryFormShortcuts({
 *   onSave: form.handleSubmit(onSubmit),
 *   onCancel: () => navigate(-1),
 *   onShowHelp: () => setHelpOpen(true),
 *   isDirty: form.formState.isDirty,
 *   isSubmitting: form.formState.isSubmitting,
 * });
 * ```
 */
export function useEntryFormShortcuts({
  onSave,
  onCancel,
  isDirty,
  isSubmitting = false,
  enabled = true,
}: EntryFormShortcutsOptions): void {
  // Store state values in refs to avoid stale closures
  const isDirtyRef = useRef(isDirty);
  const isSubmittingRef = useRef(isSubmitting);

  useLayoutEffect(() => {
    isDirtyRef.current = isDirty;
    isSubmittingRef.current = isSubmitting;
  });

  const shortcuts: Shortcut[] = [
    {
      key: "s",
      ctrl: true,
      action: onSave,
      description: "Save entry",
      when: () => isDirtyRef.current && !isSubmittingRef.current,
    },
    {
      key: "Escape",
      action: onCancel,
      description: "Cancel and go back",
    },
  ];

  useKeyboardShortcuts(shortcuts, { enabled });
}
