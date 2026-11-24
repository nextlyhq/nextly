"use client";

/**
 * What every Settings › Languages dialog shares: how it saves, where a refused
 * change is said, and the frame of the two that ask for a language's details.
 */

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import type React from "react";

import type { LanguageChange } from "@admin/types/languages";

/** How a dialog saves its one change, and what the last attempt answered. */
export interface LanguageDialogSave {
  saving: boolean;
  /** The refused change's message, if the last attempt was refused. */
  error: string | undefined;
  /** Makes the change; resolves true once it is saved. */
  onSave: (change: LanguageChange) => Promise<boolean>;
  onClose: () => void;
  /** The control that opened the dialog, given focus back when it closes. */
  opener: HTMLElement | null;
  /**
   * Given focus instead when the opener has gone by then, as a removed
   * language's menu button has once the removal is saved.
   */
  openerGone: HTMLElement | null;
}

/**
 * Gives focus back to the dialog's opener as it closes, or to `openerGone`
 * when the opener is no longer on the page. Radix gives it to a dialog's own
 * trigger, and these dialogs are opened from a button or a menu without one,
 * so focus would otherwise fall to the page.
 */
function returnFocusTo(
  opener: HTMLElement | null,
  openerGone: HTMLElement | null
) {
  return (event: Event): void => {
    event.preventDefault();
    if (opener?.isConnected) opener.focus();
    else if (openerGone?.isConnected) openerGone.focus();
  };
}

/** A refused change's message, announced where the change was asked. */
function DialogError({
  error,
}: {
  error: string | undefined;
}): React.JSX.Element | null {
  if (!error) return null;
  return (
    <p className="text-sm text-danger-text" role="alert">
      {error}
    </p>
  );
}

export interface LanguageConfirmDialogProps extends LanguageDialogSave {
  title: string;
  /** What the change does, said before it is confirmed. */
  children: React.ReactNode;
  /** The change confirmed, or undefined while it may not be made yet. */
  change: LanguageChange | undefined;
  confirmLabel: string;
  savingLabel: string;
  /** Red only for a change that takes something away; every other confirm is primary. */
  variant: "primary" | "destructive";
}

/**
 * A change that is confirmed after reading what it does. The confirm is a
 * plain button rather than the alert dialog's own action, which would close
 * the dialog before the answer arrived; a refusal is said inside it.
 */
export function LanguageConfirmDialog({
  title,
  children,
  change,
  confirmLabel,
  savingLabel,
  variant,
  saving,
  error,
  onSave,
  onClose,
  opener,
  openerGone,
}: LanguageConfirmDialogProps): React.JSX.Element {
  return (
    <AlertDialog
      open
      onOpenChange={open => {
        if (!open && !saving) onClose();
      }}
    >
      <AlertDialogContent onCloseAutoFocus={returnFocusTo(opener, openerGone)}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-foreground">{children}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <DialogError error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant={variant}
            disabled={!change || saving}
            onClick={() => {
              if (!change) return;
              void onSave(change).then(saved => {
                if (saved) onClose();
              });
            }}
          >
            {saving ? savingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface LanguageFormDialogProps extends LanguageDialogSave {
  title: string;
  description: React.ReactNode;
  /** The change the form makes as it stands, or undefined while it is incomplete. */
  change: LanguageChange | undefined;
  submitLabel: string;
  savingLabel: string;
  children: React.ReactNode;
}

/**
 * A dialog that asks for a language's details and saves them as one change.
 * Held open while saving, so the answer lands where it was asked, and kept
 * open on a refusal with what was typed.
 */
export function LanguageFormDialog({
  title,
  description,
  change,
  submitLabel,
  savingLabel,
  saving,
  error,
  onSave,
  onClose,
  opener,
  openerGone,
  children,
}: LanguageFormDialogProps): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        size="md"
        onCloseAutoFocus={returnFocusTo(opener, openerGone)}
      >
        <form
          className="space-y-4"
          onSubmit={event => {
            event.preventDefault();
            if (!change || saving) return;
            void onSave(change).then(saved => {
              if (saved) onClose();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogError error={error} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!change || saving}>
              {saving ? savingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
