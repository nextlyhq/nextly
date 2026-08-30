"use client";

/**
 * Calling off a scheduled release.
 *
 * Confirmed rather than immediate, and the confirmation states the consequence
 * in the editor's terms: cancelling is not "undo scheduling", it is a terminal
 * state. A cancelled release is never materialised again, so the documents in it
 * stay exactly as they are and the launch simply does not happen.
 *
 * @module components/features/releases/CancelReleaseButton
 */

import { useState } from "react";

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
} from "@admin/components/ui";
import { useCancelRelease } from "@admin/hooks/queries/useReleases";
import type { Release } from "@admin/types/releases";

import { formatScheduledAt } from "./release-schedule";

export function CancelReleaseButton({ release }: { release: Release }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCancelRelease(release.id);
  const at = formatScheduledAt(release);
  // Cancelling is also the only way to be rid of a DRAFT — there is no delete
  // route — and "Cancel release" is the wrong word for something that was never
  // committed to a moment in the first place.
  const abandoning = release.state === "draft";

  return (
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <Button
        variant="outline"
        onClick={() => setConfirming(true)}
        disabled={cancel.isPending}
      >
        {abandoning ? "Discard release" : "Cancel release"}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {abandoning ? "Discard this release?" : "Cancel this release?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {at
              ? `Nothing will go live ${at}. `
              : "Nothing in this release will go live. "}
            The documents themselves are not changed. You can schedule it again
            later if you change your mind.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {abandoning ? "Keep it" : "Keep it scheduled"}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => cancel.mutate()}>
            {abandoning ? "Discard release" : "Cancel release"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
