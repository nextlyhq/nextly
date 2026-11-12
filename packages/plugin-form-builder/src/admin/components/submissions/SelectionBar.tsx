"use client";

/**
 * The bar the submissions list shows while rows are ticked: how many, and
 * what can be done to those rows alone. Each action is offered only to a
 * person whose role allows it (the server judges each row again), and Delete
 * asks first.
 *
 * @module admin/components/submissions/SelectionBar
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@nextlyhq/ui";
import { Archive, Ban, CheckCheck, Inbox, Trash2, X } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";

import type { BulkChange } from "./bulk-actions";

/** What the person may do to the ticked rows. */
export interface SelectionRights {
  update: boolean;
  delete: boolean;
}

/** One action's button. */
function Action({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-2 px-3"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

/** Delete's question: the ticked submissions are gone for good once answered. */
function ConfirmDelete({
  count,
  open,
  onOpenChange,
  onConfirm,
}: {
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}): JSX.Element {
  const what = count === 1 ? "this submission" : `these ${count} submissions`;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1
              ? "Delete 1 submission?"
              : `Delete ${count} submissions?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {`The answers in ${what} are deleted for good, and can't be brought back.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep them</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const ICON = "h-4 w-4";

export function SelectionBar({
  count,
  rights,
  spamTab,
  busy,
  exportMenu,
  onChange,
  onClear,
}: {
  count: number;
  rights: SelectionRights;
  /** On the Spam tab the bar offers Not spam in Spam's place. */
  spamTab: boolean;
  /** A change is being sent; nothing else is offered until it is answered. */
  busy: boolean;
  /** The export of the ticked rows, when the person may export. */
  exportMenu: ReactNode;
  onChange: (change: BulkChange) => void;
  onClear: () => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      role="region"
      aria-label="Selected submissions"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-card-foreground"
    >
      <p className="flex items-center gap-1 font-medium" aria-live="polite">
        {count} selected
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Clear the selection"
          onClick={onClear}
        >
          <X className={ICON} aria-hidden="true" />
        </Button>
      </p>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {rights.update && (
          <>
            <Action
              icon={<CheckCheck className={ICON} aria-hidden="true" />}
              label="Mark as read"
              disabled={busy}
              onClick={() => onChange("read")}
            />
            <Action
              icon={<Archive className={ICON} aria-hidden="true" />}
              label="Archive"
              disabled={busy}
              onClick={() => onChange("archived")}
            />
            {spamTab ? (
              <Action
                icon={<Inbox className={ICON} aria-hidden="true" />}
                label="Not spam"
                disabled={busy}
                onClick={() => onChange("notSpam")}
              />
            ) : (
              <Action
                icon={<Ban className={ICON} aria-hidden="true" />}
                label="Spam"
                disabled={busy}
                onClick={() => onChange("spam")}
              />
            )}
          </>
        )}
        {exportMenu}
        {rights.delete && (
          <Action
            icon={<Trash2 className={ICON} aria-hidden="true" />}
            label="Delete"
            disabled={busy}
            onClick={() => setConfirming(true)}
          />
        )}
      </div>
      <ConfirmDelete
        count={count}
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => onChange("delete")}
      />
    </div>
  );
}
