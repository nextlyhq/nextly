"use client";

/**
 * The dialog that asks a super-admin for their password before a
 * collection is closed to super-admin, or opened to them again.
 *
 * The password field takes the focus when it opens, Enter confirms, and a
 * refusal (a wrong password, too many tries) is shown under the field and
 * announced, so the person can correct it without leaving the dialog.
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@nextlyhq/ui";
import { useState, type FormEvent, type JSX } from "react";

import { Loader2 } from "@admin/components/icons";

/** The change the dialog asks a password for. */
export interface PendingClosedMark {
  /** The collection's name as the screen shows it. */
  name: string;
  closed: boolean;
}

export interface ClosedMarkDialogProps {
  /** The change asked for, or null while the dialog is closed. */
  pending: PendingClosedMark | null;
  saving: boolean;
  /** Why the last try was refused, shown under the password; null for none. */
  refusal: string | null;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

const PASSWORD_ID = "closed-to-super-admin-password";
const REFUSAL_ID = "closed-to-super-admin-refusal";

export function ClosedMarkDialog({
  pending,
  saving,
  refusal,
  onConfirm,
  onCancel,
}: ClosedMarkDialogProps): JSX.Element {
  const [password, setPassword] = useState("");
  const closing = pending?.closed === true;
  const name = pending?.name ?? "";
  const close = () => {
    setPassword("");
    onCancel();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password.length > 0 && !saving) onConfirm(password);
  };

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={open => {
        if (!open && !saving) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {closing
                ? `Close ${name} to super-admins?`
                : `Open ${name} to super-admins again?`}
            </DialogTitle>
            <DialogDescription>
              {closing
                ? "Super-admins, you included, and full-access API keys will be refused its entries. Your app's own server code still reads them."
                : "Super-admins and full-access API keys will be able to read and change its entries again."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={PASSWORD_ID}>Your password</Label>
            <Input
              id={PASSWORD_ID}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={event => setPassword(event.target.value)}
              disabled={saving}
              aria-invalid={refusal !== null}
              aria-describedby={refusal !== null ? REFUSAL_ID : undefined}
            />
            {refusal !== null ? (
              <p
                id={REFUSAL_ID}
                role="alert"
                className="text-sm font-medium text-danger-text"
              >
                {refusal}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                The change is recorded in the audit log under your name.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={password.length === 0 || saving}>
              {saving && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              )}
              {closing ? "Close collection" : "Open collection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
