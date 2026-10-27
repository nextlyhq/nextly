"use client";

/**
 * The confirmations before an email changes hands: Override makes an owner's
 * email the site's, Reset gives it back, and a review can't start over unsaved
 * edits.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { CheckCircle2, Loader2 } from "@admin/components/icons";

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2.5 text-sm text-foreground">
      {items.map(item => (
        <li key={item} className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Confirm({
  open,
  onOpenChange,
  title,
  description,
  bullets,
  confirmLabel,
  pendingLabel,
  destructive,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  bullets: string[];
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  isPending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Bullets items={bullets} />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {pendingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What each confirmation says, by act. */
const CONFIRM_COPY = {
  override: (
    name: string,
    owner: string
  ): {
    title: string;
    description: string;
    bullets: string[];
    confirmLabel: string;
    pendingLabel: string;
    destructive: boolean;
  } => ({
    title: `Override ${name}?`,
    description: `Your site will have its own version of ${owner}'s email.`,
    bullets: [
      `Your version starts as ${owner}'s current one, and you can then change its subject, preview text and body.`,
      `${owner}'s later updates wait for your review instead of replacing your version.`,
      `You can reset to ${owner}'s version at any time. Both are recorded in the activity log.`,
    ],
    confirmLabel: "Override",
    pendingLabel: "Overriding…",
    destructive: false,
  }),
  reset: (
    name: string,
    owner: string,
    undoable: boolean
  ): {
    title: string;
    description: string;
    bullets: string[];
    confirmLabel: string;
    pendingLabel: string;
    destructive: boolean;
  } => ({
    title: `Reset ${name} to ${owner}'s version?`,
    description: `Your site's version is replaced by ${owner}'s current one.`,
    bullets: [
      `The subject, preview text and both bodies become ${owner}'s again, and ${owner} keeps them up to date.`,
      "Your settings stay as they are: name, layout, provider, sending, From, Reply-To, copies and attachments.",
      undoable
        ? "You can undo it until you leave this email."
        : `It can't be undone: ${owner}'s update waiting for your review is part of the version it returns to.`,
    ],
    confirmLabel: "Reset",
    pendingLabel: "Resetting…",
    destructive: true,
  }),
};

/** The confirmation before an email changes hands: Override or Reset. */
export function OwnershipConfirm({
  act,
  name,
  owner,
  undoable = true,
  ...rest
}: {
  act: keyof typeof CONFIRM_COPY;
  /** Whether the act can be undone afterwards (a Reset, while no update waits). */
  undoable?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  owner: string;
  isPending: boolean;
  onConfirm: () => void;
}): JSX.Element {
  return <Confirm {...rest} {...CONFIRM_COPY[act](name, owner, undoable)} />;
}

/**
 * Override, Reset and a review start from what's saved and replace what's on
 * screen, so unsaved edits go first.
 */
export function UnsavedBeforeActDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save or discard your changes first</DialogTitle>
          <DialogDescription>
            Overriding, resetting and reviewing an update start from the saved
            version of this email, so they can&apos;t keep changes you
            haven&apos;t saved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            Discard changes and continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
