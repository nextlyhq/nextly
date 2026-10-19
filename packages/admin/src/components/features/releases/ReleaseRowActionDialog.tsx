"use client";

/**
 * The confirmation behind each of the list's row actions that cannot be undone
 * by the next click: publishing now, cancelling, and deleting.
 *
 * One dialog for the three, chosen by `action`, because they share everything
 * but their words: the release named in the title, the consequence said before
 * the button, and a failure shown INSIDE the dialog. The confirming button is
 * a plain button rather than the dialog's own action, which closes on click:
 * a refusal that appears after the dialog has gone is missed by exactly the
 * person who believes the release was published, cancelled or deleted.
 *
 * @module components/features/releases/ReleaseRowActionDialog
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
} from "@admin/components/ui";
import {
  useCancelRelease,
  useDeleteRelease,
  usePublishReleaseNow,
} from "@admin/hooks/queries/useReleases";
import type { Release } from "@admin/types/releases";

import { releaseErrorMessage } from "./release-error";

export type ReleaseRowAction = "publish" | "cancel" | "delete";

interface ActionWords {
  title: string;
  body: string;
  confirm: string;
  working: string;
  keep: string;
  failed: string;
  destructive: boolean;
}

/** What each action says, for this release. */
function wordsFor(action: ReleaseRowAction, release: Release): ActionWords {
  const draft = release.state === "draft";
  switch (action) {
    case "publish":
      return {
        title: `Publish “${release.title}” now?`,
        body: "Every document in it changes now, as it would have at its scheduled time: those set to go live are published, and those set to come down are unpublished.",
        confirm: "Publish now",
        working: "Publishing…",
        keep: "Not now",
        failed: "This release was not published. Nothing in it has changed.",
        destructive: false,
      };
    case "cancel":
      return {
        title: draft
          ? `Discard “${release.title}”?`
          : `Cancel “${release.title}”?`,
        body: draft
          ? "It moves to Done as cancelled, and nothing in it will go live. The documents themselves are not changed."
          : "Nothing in it will go live, and it moves to Done as cancelled. The documents themselves are not changed.",
        confirm: draft ? "Discard release" : "Cancel release",
        working: "Cancelling…",
        keep: draft ? "Keep it" : "Keep it scheduled",
        failed: draft
          ? "This release was not discarded."
          : "This release was not cancelled. It is still scheduled.",
        destructive: false,
      };
    case "delete":
      return {
        title: `Delete “${release.title}”?`,
        body: "The release is removed for good. The documents in it are not changed, and nothing goes live or comes down.",
        confirm: "Delete release",
        working: "Deleting…",
        keep: "Keep it",
        failed: "This release was not deleted.",
        destructive: true,
      };
  }
}

export interface ReleaseRowActionDialogProps {
  release: Release;
  action: ReleaseRowAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReleaseRowActionDialog({
  release,
  action,
  open,
  onOpenChange,
}: ReleaseRowActionDialogProps) {
  // All three hooks, every render: which one runs is chosen by `action`, and a
  // hook called conditionally would change the order React reads them in.
  const publish = usePublishReleaseNow(release.id);
  const cancel = useCancelRelease(release.id);
  const remove = useDeleteRelease(release.id);
  const mutation =
    action === "publish" ? publish : action === "cancel" ? cancel : remove;
  const words = wordsFor(action, release);
  const confirm = () => {
    const done = { onSuccess: () => onOpenChange(false) };
    if (action === "publish") publish.mutate(undefined, done);
    else if (action === "cancel") cancel.mutate(undefined, done);
    else remove.mutate(undefined, done);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        // Dismissing clears a failure too, so the next action on this release
        // does not open onto the last one's error.
        if (!next) mutation.reset();
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{words.title}</AlertDialogTitle>
          <AlertDialogDescription>{words.body}</AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {releaseErrorMessage(mutation.error, words.failed)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>
            {words.keep}
          </AlertDialogCancel>
          <Button
            variant={words.destructive ? "destructive" : "default"}
            disabled={mutation.isPending}
            onClick={confirm}
          >
            {mutation.isPending ? words.working : words.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
