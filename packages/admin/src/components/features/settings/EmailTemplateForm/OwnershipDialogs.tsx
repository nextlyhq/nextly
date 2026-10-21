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

export function OverrideDialog({
  open,
  onOpenChange,
  name,
  owner,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  owner: string;
  isPending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Confirm
      open={open}
      onOpenChange={onOpenChange}
      title={`Override ${name}?`}
      description={`Your site will have its own version of ${owner}'s email.`}
      bullets={[
        `Your version starts as ${owner}'s current one, and you can then change its subject, preview text and body.`,
        `${owner}'s later updates wait for your review instead of replacing your version.`,
        `You can reset to ${owner}'s version at any time. Both are recorded in the activity log.`,
      ]}
      confirmLabel="Override"
      pendingLabel="Overriding…"
      isPending={isPending}
      onConfirm={onConfirm}
    />
  );
}

export function ResetDialog({
  open,
  onOpenChange,
  name,
  owner,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  owner: string;
  isPending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Confirm
      open={open}
      onOpenChange={onOpenChange}
      title={`Reset ${name} to ${owner}'s version?`}
      description={`Your site's version is replaced by ${owner}'s current one.`}
      bullets={[
        `The subject, preview text and both bodies become ${owner}'s again, and ${owner} keeps them up to date.`,
        "Your settings stay as they are: name, layout, provider, sending, From, Reply-To, copies and attachments.",
        "You can undo it until you leave this email.",
      ]}
      confirmLabel="Reset"
      pendingLabel="Resetting…"
      destructive
      isPending={isPending}
      onConfirm={onConfirm}
    />
  );
}

/** A review starts from what's saved, so unsaved edits go first. */
export function UnsavedBeforeReviewDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save or discard your changes first</DialogTitle>
          <DialogDescription>
            The review compares the owner&apos;s update with your saved version,
            so it can&apos;t include changes you haven&apos;t saved.
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
            Discard changes and review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
