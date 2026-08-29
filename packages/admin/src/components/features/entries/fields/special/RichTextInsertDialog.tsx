import { Button, DialogFooter, Label } from "@nextlyhq/ui";
import {
  useState,
  useCallback,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  AlertCircle,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "@admin/components/icons";

// The alignment contract is owned by the node models; the shared control is a
// consumer of it, not a second author. Re-exported so plugin consumers can
// keep importing the type from either surface.
import type { ButtonAlignment as NodeButtonAlignment } from "./ButtonLinkNode";

// ============================================================
// Types
// ============================================================

export type ButtonAlignment = NodeButtonAlignment;

export interface UseInsertDialogStateOptions {
  /** Callback to clear form state when the dialog closes or reopens */
  resetState: () => void;
  /** Submission action triggered on Enter keypress */
  onSubmit: () => void;
  /** When true, opening the dialog is blocked */
  disabled?: boolean;
}

export interface UseInsertDialogStateReturn {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  openDialog: () => void;
  handleOpenChange: (open: boolean) => void;
  handleKeyDown: (e: KeyboardEvent) => void;
}

export interface InsertDialogFooterProps {
  /** Optional error message displayed above the action buttons */
  error?: string | null;
  /** Action called when Cancel is clicked */
  onCancel: () => void;
  /** Action called when Confirm/Insert is clicked */
  onConfirm: () => void;
  /** Text label for the confirmation button */
  confirmLabel: string;
  /** Whether the confirmation button is disabled */
  confirmDisabled?: boolean;
  /** Text label for the cancellation button (default: "Cancel") */
  cancelLabel?: string;
}

export interface ButtonAlignmentControlProps {
  /** Current alignment value */
  value: ButtonAlignment;
  /** Callback fired when alignment selection changes */
  onChange: (value: ButtonAlignment) => void;
  /** Label text (default: "Alignment") */
  label?: string;
  /** Whether the control is disabled */
  disabled?: boolean;
}

// ============================================================
// Hook: useInsertDialogState
// ============================================================

// Input types whose Enter key activates the control itself rather than
// submitting the surrounding dialog.
const NON_TEXT_INPUT_TYPES = [
  "button",
  "checkbox",
  "color",
  "file",
  "radio",
  "range",
  "reset",
  "submit",
];

/**
 * Shared state and event handling for rich-text plugin insert dialogs.
 * Encapsulates open/close toggling, state resets, and Enter-to-submit keydown handling.
 */
export function useInsertDialogState({
  resetState,
  onSubmit,
  disabled = false,
}: UseInsertDialogStateOptions): UseInsertDialogStateReturn {
  const [isOpen, setIsOpen] = useState(false);

  const openDialog = useCallback(() => {
    if (disabled) return;
    resetState();
    setIsOpen(true);
  }, [disabled, resetState]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        resetState();
      }
      setIsOpen(open);
    },
    [resetState]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      // Enter that accepts an IME composition candidate (CJK and other
      // composed input) must not submit. During composition the keydown
      // reports isComposing, and older engines report keyCode 229.
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      // Enter submits only while the user is typing in a text field. On
      // buttons and checkboxes Enter activates the focused control, and the
      // wrapped Radix Select does not stop its option keydown from bubbling,
      // which would submit the dialog mid-selection.
      const el = e.target;
      const fromTextField =
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement &&
          !NON_TEXT_INPUT_TYPES.includes(el.type));
      if (fromTextField) {
        e.preventDefault();
        onSubmit();
      }
    },
    [onSubmit]
  );

  return {
    isOpen,
    setIsOpen,
    openDialog,
    handleOpenChange,
    handleKeyDown,
  };
}

// ============================================================
// Component: InsertDialogFooter
// ============================================================

/**
 * Shared footer for rich-text insert dialogs: renders an optional error alert
 * banner alongside standardized Cancel and Confirm action buttons.
 */
export function InsertDialogFooter({
  error,
  onCancel,
  onConfirm,
  confirmLabel,
  confirmDisabled = false,
  cancelLabel = "Cancel",
}: InsertDialogFooterProps): ReactNode {
  return (
    <>
      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" onClick={onConfirm} disabled={confirmDisabled}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

// ============================================================
// Component: ButtonAlignmentControl
// ============================================================

const ALIGNMENT_OPTIONS = [
  { value: "left", label: "Left", icon: AlignLeft },
  { value: "center", label: "Center", icon: AlignCenter },
  { value: "right", label: "Right", icon: AlignRight },
] as const;

/**
 * Shared alignment button selector for Button and Button Group rich-text dialogs.
 */
export function ButtonAlignmentControl({
  value,
  onChange,
  label = "Alignment",
  disabled = false,
}: ButtonAlignmentControlProps): ReactNode {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex gap-2">
        {ALIGNMENT_OPTIONS.map(
          ({ value: optValue, label: optLabel, icon: Icon }) => (
            <Button
              key={optValue}
              type="button"
              variant={value === optValue ? "default" : "outline"}
              size="md"
              className="flex-1 gap-1.5"
              onClick={() => onChange(optValue)}
              disabled={disabled}
            >
              <Icon className="h-4 w-4" />
              {optLabel}
            </Button>
          )
        )}
      </div>
    </div>
  );
}
