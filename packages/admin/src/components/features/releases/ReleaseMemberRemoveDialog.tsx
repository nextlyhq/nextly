"use client";

/**
 * The confirmation before a document leaves a release, wherever it is asked
 * for: on the release's page, and on the document's own screen.
 *
 * One dialog for both, so the document is taken out with the same words and
 * the same refusal handling whichever screen the reader is on.
 *
 * @module components/features/releases/ReleaseMemberRemoveDialog
 */

import type { JSX } from "react";

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
import { useRemoveReleaseMember } from "@admin/hooks/queries/useReleases";

import { releaseErrorMessage } from "./release-error";

export interface ReleaseMemberRemoveDialogProps {
  releaseId: string;
  /** The membership taken out: the document's place in this release. */
  memberId: string;
  /**
   * The document's name, as the screen asking shows it. Absent on the
   * document's own screen, where "this document" names it.
   */
  title?: string;
  /** Whether taking it out cancels the release (see `memberControls`). */
  cancelsRelease: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Held open while the removal is failing, so a refusal is read by the person
 * who asked for it. Taking the only document out of a single-document release
 * cancels the release, and the confirmation says so before anything happens.
 */
export function ReleaseMemberRemoveDialog({
  releaseId,
  memberId,
  title,
  cancelsRelease,
  open,
  onOpenChange,
}: ReleaseMemberRemoveDialogProps): JSX.Element {
  const remove = useRemoveReleaseMember(releaseId);
  return (
    <AlertDialog
      open={open || remove.isError}
      onOpenChange={next => {
        if (!next) remove.reset();
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          {/* A title that names the document runs to two lines; the theme's
              snug leading keeps them apart where the shared style sets none. */}
          <AlertDialogTitle className="leading-snug">
            {`Remove ${title === undefined ? "this document" : `“${title}”`} ${
              cancelsRelease ? "and cancel this release" : "from this release"
            }?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {cancelsRelease
              ? "This is a single-document release: it holds only this document. This cancels the release. It moves to Done as cancelled, and nothing in it goes live or comes down. The document itself is not changed."
              : "The document itself is not changed. It simply stops being part of what this release does."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError ? (
          <p
            role="alert"
            className="text-sm text-destructive-700 dark:text-destructive"
          >
            {releaseErrorMessage(
              remove.error,
              "This document was not removed. It is still in the release."
            )}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            Keep it
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(memberId, { onSuccess: () => onOpenChange(false) })
            }
          >
            {remove.isPending
              ? "Removing…"
              : cancelsRelease
                ? "Remove and cancel release"
                : "Remove"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
