"use client";

/**
 * The dialog that asks a super-admin for their password before a
 * collection is closed to super-admin, or opened to them again.
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
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

export function ClosedMarkDialog({
  pending,
  saving,
  onConfirm,
  onCancel,
}: ClosedMarkDialogProps): JSX.Element {
  const [password, setPassword] = useState("");
  const close = () => {
    setPassword("");
    onCancel();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password.length > 0) onConfirm(password);
  };
  const verb = pending?.closed ? "Close" : "Open";

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={open => {
        if (!open && !saving) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{`${verb} ${pending?.name ?? ""} to super-admins?`}</DialogTitle>
            <DialogDescription>
              {pending?.closed
                ? "Every super-admin, you included, and every full-access key will be refused its entries."
                : "Every super-admin and full-access key will be able to read and change its entries again."}{" "}
              Enter your password to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="closed-to-super-admin-password">Password</Label>
            <Input
              id="closed-to-super-admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              disabled={saving}
            />
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
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
