"use client";

/**
 * Keyboard Shortcuts Hook
 *
 * Registers admin shortcuts with the shared shortcut manager in `@nextlyhq/ui`, which owns the
 * application's single `keydown` listener.
 *
 * ## Why this is an adapter rather than a listener
 *
 * Each instance of this hook used to add its OWN listener to `document`. That is the arrangement
 * the manager exists to remove: `stopPropagation()` does not stop other listeners on the same
 * node, so when two of them wanted a key both ran, and which one "won" was decided by mount order
 * — something no developer chose. Precedence now comes from the component tree.
 *
 * The exported hooks keep the shape they had, so callers did not change. What changed underneath
 * is that a shortcut is a declaration handed to one owner rather than a listener of its own.
 *
 * @module hooks/useKeyboardShortcuts
 */

import { useShortcuts, type ShortcutBinding } from "@nextlyhq/ui";

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
  /**
   * Whether this fires while the user is typing in a field. Defaults to false.
   *
   * The manager's own default is true for modifier-led bindings, which is wrong for a shortcut
   * whose combination a text field already owns: `mod+a` means "select this text" inside an input
   * and must not select every row in the list behind it. So the default here is the conservative
   * one and each shortcut that genuinely belongs to the application opts in.
   */
  whenTyping?: boolean;
}

/**
 * Options for the useKeyboardShortcuts hook.
 */
export interface UseKeyboardShortcutsOptions {
  /** Whether shortcuts are enabled (default: true) */
  enabled?: boolean;
  /** Identifies the layer in diagnostics and in a shortcuts help panel. */
  name?: string;
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
// Translation
// ============================================================================

/**
 * Render a shortcut as the key spec the manager parses.
 *
 * `ctrl` becomes `mod`, not `ctrl`: this hook has always treated `ctrl: true` as "Control OR
 * Command", which is exactly what `mod` resolves to per platform. Emitting a literal `ctrl` would
 * stop every shortcut working on macOS.
 */
export function toKeySpec(shortcut: Shortcut): string {
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push("mod");
  if (shortcut.alt) parts.push("alt");
  if (shortcut.shift) parts.push("shift");
  parts.push(shortcut.key);
  return parts.join("+");
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Hook for registering and handling keyboard shortcuts.
 *
 * Bindings are rebuilt on every render and handed to the manager, which is what keeps their
 * closures fresh — a caller does not need to memoize its callbacks or hold values in refs.
 *
 * @param shortcuts - Array of shortcut configurations
 * @param options - Hook options
 *
 * @example
 * ```tsx
 * useKeyboardShortcuts(
 *   [
 *     { key: "s", ctrl: true, action: handleSave, description: "Save entry" },
 *     { key: "Escape", action: handleCancel, description: "Cancel and go back" },
 *   ],
 *   { name: "entry-form" }
 * );
 * ```
 */
export function useKeyboardShortcuts(
  shortcuts: Shortcut[],
  options: UseKeyboardShortcutsOptions = {}
): void {
  const { enabled = true, name = "admin" } = options;

  const bindings: ShortcutBinding[] = shortcuts.map(shortcut => ({
    keys: toKeySpec(shortcut),
    description: shortcut.description,
    run: shortcut.action,
    when: shortcut.when,
    whenTyping: shortcut.whenTyping ?? false,
  }));

  useShortcuts(bindings, { name, enabled });
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
 *
 * @param options - Entry list shortcut options
 */
export function useEntryListShortcuts({
  onNew,
  onSearch,
  onSelectAll,
  onDelete,
  hasSelection,
  enabled = true,
}: EntryListShortcutsOptions): void {
  // Read directly rather than through refs. The bindings are rebuilt each render and handed to
  // the manager, so `hasSelection` is already the current value by the time `when` runs; the refs
  // this hook used to keep existed only because a long-lived listener captured its closure once.
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
      // Deliberately NOT `whenTyping`. Inside a text field this combination selects the text, and
      // taking it to select every row would break editing in the field the user is looking at.
      key: "a",
      ctrl: true,
      action: onSelectAll,
      description: "Select all entries",
    },
    {
      key: "Delete",
      action: onDelete,
      description: "Delete selected entries",
      when: () => hasSelection,
    },
  ];

  useKeyboardShortcuts(shortcuts, { enabled, name: "entry-list" });
}

/**
 * Keyboard shortcuts for the entry form page.
 *
 * Shortcuts:
 * - Ctrl+S: Save entry (when form is dirty and not submitting)
 * - Escape: Cancel and go back
 *
 * @param options - Entry form shortcut options
 */
export function useEntryFormShortcuts({
  onSave,
  onCancel,
  isDirty,
  isSubmitting = false,
  enabled = true,
}: EntryFormShortcutsOptions): void {
  const shortcuts: Shortcut[] = [
    {
      key: "s",
      ctrl: true,
      action: onSave,
      description: "Save entry",
      when: () => isDirty && !isSubmitting,
      // The one shortcut that fires mid-sentence. Save is the command a person reaches for
      // WITHOUT leaving the field they are editing, and refusing it there is the behaviour people
      // report as the shortcut being broken.
      whenTyping: true,
    },
    {
      // Escape stays out of fields: it is how a menu, a popover or a composition session is
      // dismissed, and cancelling the whole form out from under one of those is not what the
      // keystroke meant.
      key: "Escape",
      action: onCancel,
      description: "Cancel and go back",
    },
  ];

  useKeyboardShortcuts(shortcuts, { enabled, name: "entry-form" });
}
