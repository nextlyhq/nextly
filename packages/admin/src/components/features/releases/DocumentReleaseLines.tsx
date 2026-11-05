"use client";

/**
 * What a reader can see and do, on a document's own screen, about each release
 * holding it: when it acts, on the reader's clock with the zone it was scheduled
 * in beside it; Change time on a single-document release; Remove; and, where two
 * act at one moment, which one readers end up with.
 *
 * One module, so the document's release list draws these the one way, and the
 * release's own page and this agree on what may be done: every control stands
 * on the capabilities the server sent (`memberControls`, `releaseActionsFor`).
 *
 * @module components/features/releases/DocumentReleaseLines
 */

import { useId, useState, type JSX } from "react";

import { Button } from "@admin/components/ui";
import type { Release } from "@admin/types/releases";

import { memberControls } from "./release-member-controls";
import { releaseTimeSentence, releaseTimeText } from "./release-time";
import { readerZone } from "./release-timezone";
import { ReleaseMemberRemoveDialog } from "./ReleaseMemberRemoveDialog";
import {
  releaseActionsFor,
  ReleaseRowDialogs,
  type OpenDialog,
} from "./ReleaseRowMenu";

/** The moment a release acts, on the reader's clock with the scheduled zone beside it. */
export function releaseWhen(release: Release, now: number): string | null {
  const text = releaseTimeText(release.scheduledAt, {
    readerZone: readerZone(),
    scheduledZone: release.timezone,
    now,
  });
  return text ? releaseTimeSentence(text) : null;
}

/**
 * Which release a reader ends up with where several act on this document at
 * one moment: the last of them in the server's order, which is the order the
 * engine applies them in. `null` where no two share a moment.
 */
export function winnerSentence(
  releases: readonly Release[],
  now: number
): string | null {
  const byMoment = new Map<number, Release[]>();
  for (const release of releases) {
    if (release.state !== "scheduled" || !release.scheduledAt) continue;
    const at = new Date(release.scheduledAt).getTime();
    if (Number.isNaN(at)) continue;
    byMoment.set(at, [...(byMoment.get(at) ?? []), release]);
  }
  for (const together of byMoment.values()) {
    if (together.length < 2) continue;
    const last = together[together.length - 1];
    const at = releaseWhen(last, now);
    const who = together.length === 2 ? "Both" : `${together.length} releases`;
    return `${who} act on this document${at ? ` at ${at}` : " at one moment"}. ${last.title} was scheduled last, so its version is the one readers get.`;
  }
  return null;
}

/** Where a line's own controls send the reader. */
interface ReleaseLineActions {
  /** Reopens the schedule of a single-document release. */
  onChangeTime: (release: Release) => void;
  /** Asks to take this document out of the release. */
  onRemove: (release: Release) => void;
}

/**
 * The controls of one release on the document's screen: Change time where it
 * is a single-document release whose schedule may be changed, and Remove where
 * the reader may change its documents. Nothing where neither applies.
 */
export function DocumentReleaseControls({
  release,
  actions,
}: {
  release: Release;
  actions: ReleaseLineActions;
}): JSX.Element | null {
  const reasonId = useId();
  const remove = memberControls(release).remove;
  // The schedule is reopened only where the release's own list of actions
  // offers it, so this and the release's page never disagree about it.
  const changeTime =
    release.kind === "single" &&
    releaseActionsFor(release).some(action => action.id === "schedule");
  // Taken out by its place in the release, which only a read narrowed to this
  // document carries.
  const removable = remove.offered && release.memberId !== undefined;
  if (!changeTime && !removable) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {changeTime ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => actions.onChangeTime(release)}
        >
          Change time
        </Button>
      ) : null}
      {removable ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={remove.disabledReason !== null}
            aria-label={`Remove from ${release.title}…`}
            aria-describedby={remove.disabledReason ? reasonId : undefined}
            onClick={() => actions.onRemove(release)}
          >
            Remove
          </Button>
          {remove.disabledReason ? (
            <span id={reasonId} className="text-xs text-muted-foreground">
              {remove.disabledReason}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

/**
 * The state the controls open, and the dialogs they open, mounted once for
 * the whole list: the remove confirmation, and the release's own schedule
 * dialog, the one its page and the releases list open.
 */
export function useDocumentReleaseActions(): {
  actions: ReleaseLineActions;
  dialogs: JSX.Element;
} {
  const [removing, setRemoving] = useState<Release | null>(null);
  const [rowDialog, setRowDialog] = useState<OpenDialog | null>(null);
  const [rowDialogOpen, setRowDialogOpen] = useState(false);
  const actions: ReleaseLineActions = {
    onChangeTime: release => {
      setRowDialog({ release, action: "schedule" });
      setRowDialogOpen(true);
    },
    onRemove: setRemoving,
  };
  const dialogs = (
    <>
      {removing !== null && removing.memberId !== undefined ? (
        <ReleaseMemberRemoveDialog
          releaseId={removing.id}
          memberId={removing.memberId}
          cancelsRelease={memberControls(removing).remove.cancelsRelease}
          open
          onOpenChange={open => {
            if (!open) setRemoving(null);
          }}
        />
      ) : null}
      <ReleaseRowDialogs
        dialog={rowDialog}
        open={rowDialogOpen}
        onOpenChange={setRowDialogOpen}
      />
    </>
  );
  return { actions, dialogs };
}
