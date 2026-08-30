"use client";

/**
 * Putting the document you are looking at into a release.
 *
 * This is the only place the choice can honestly be made. A release is a set of
 * documents, and the question "should this one go out on Friday?" is about the
 * document — asking it from the release page would mean picking an entry from a
 * list of identifiers, without its title, its state or its content in view.
 *
 * Offered only to a caller who may assemble a release, because the server's
 * refusal is one fixed sentence that cannot say why.
 *
 * @module components/features/releases/AddToReleaseButton
 */

import { useState } from "react";

import { CalendarClock } from "@admin/components/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import {
  useAddReleaseMember,
  useReleases,
} from "@admin/hooks/queries/useReleases";
import { useCan } from "@admin/hooks/useCan";
import type { Release, ReleaseMemberAction } from "@admin/types/releases";

import { describeRelease } from "./release-schedule";

export interface AddToReleaseButtonProps {
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
}

/**
 * Which releases are worth OFFERING as a target.
 *
 * Drafts always, and scheduled ones to a caller who could have scheduled them —
 * the drain reads membership at the instant, so adding to a committed launch
 * changes what a publisher agreed to, and the engine requires `publish` for it.
 *
 * Cancelled releases are assemblable and deliberately not offered: nothing added
 * to one would ever go live, so listing it invites an editor to believe they
 * have scheduled something. Rescheduling it first makes it a normal target, so
 * nothing is unreachable — only the pointless order of operations is.
 */
function useAssemblableReleases(canPublish: boolean) {
  // Asked as two narrow queries rather than one wide one. The list is ordered
  // by instant descending with nulls LAST, so drafts — the usual target — sort
  // behind every scheduled and published release and would fall outside an
  // unfiltered first window on any site with a history.
  const drafts = useReleases({ state: "draft" });
  const scheduled = useReleases({ state: "scheduled" });

  const items: Release[] = [
    ...(drafts.data?.items ?? []),
    ...(canPublish ? (scheduled.data?.items ?? []) : []),
  ];
  return {
    items,
    isPending: drafts.isPending || (canPublish && scheduled.isPending),
    isError: drafts.isError || (canPublish && scheduled.isError),
    truncated:
      (drafts.data?.meta.hasNext ?? false) ||
      (canPublish && (scheduled.data?.meta.hasNext ?? false)),
  };
}

export function AddToReleaseButton({
  scopeKind,
  scopeSlug,
  entryId,
}: AddToReleaseButtonProps) {
  const canAssemble = useCan("create-content-releases");
  const canPublish = useCan("publish-content-releases");
  const [open, setOpen] = useState(false);
  const [releaseId, setReleaseId] = useState("");
  const [action, setAction] = useState<ReleaseMemberAction>("publish");
  const releases = useAssemblableReleases(canPublish);
  const add = useAddReleaseMember(releaseId);

  if (!canAssemble) return null;

  const chosen = releases.items.find(release => release.id === releaseId);
  const canSubmit = Boolean(releaseId) && !add.isPending;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="mr-1.5 size-4" aria-hidden />
        Add to release
      </Button>

      <Dialog
        open={open}
        onOpenChange={next => {
          if (!next) {
            setReleaseId("");
            setAction("publish");
            add.reset();
          }
          setOpen(next);
        }}
      >
        <DialogContent>
          <form
            onSubmit={event => {
              event.preventDefault();
              if (!canSubmit) return;
              add.mutate(
                { scopeKind, scopeSlug, entryId, action },
                { onSuccess: () => setOpen(false) }
              );
            }}
          >
            <DialogHeader>
              <DialogTitle>Add to a release</DialogTitle>
              <DialogDescription>
                This document will be published or taken down when that release
                takes effect — not now.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-4">
              {releases.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  Releases could not be loaded.
                </p>
              ) : null}

              {!releases.isPending &&
              !releases.isError &&
              releases.items.length === 0 ? (
                // An empty picker is not an error, and saying "no releases"
                // leaves an editor stuck. The way forward is a release, so this
                // points at where one is made.
                <p className="text-sm text-muted-foreground">
                  There are no releases to add this to yet.{" "}
                  <Link href={ROUTES.RELEASES} className="underline">
                    Create one first
                  </Link>
                  .
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="target-release">Release</Label>
                  <Select value={releaseId} onValueChange={setReleaseId}>
                    <SelectTrigger id="target-release">
                      <SelectValue
                        placeholder={
                          releases.isPending
                            ? "Loading releases…"
                            : "Choose a release"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {releases.items.map(release => (
                        <SelectItem key={release.id} value={release.id}>
                          {release.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {chosen ? (
                    // The schedule, in the same words the release pages use, so
                    // an editor confirms WHEN before they confirm what.
                    <p className="text-sm text-muted-foreground">
                      {describeRelease(chosen)}
                    </p>
                  ) : null}
                  {releases.truncated ? (
                    <p className="text-sm text-muted-foreground">
                      Only the most recent releases are listed.
                    </p>
                  ) : null}
                </div>
              )}

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">
                  What should happen
                </legend>
                <RadioGroup
                  value={action}
                  onValueChange={next => setAction(next as ReleaseMemberAction)}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="publish" id="release-publish" />
                    <Label htmlFor="release-publish" className="font-normal">
                      Publish it — make this document live
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="unpublish" id="release-unpublish" />
                    <Label htmlFor="release-unpublish" className="font-normal">
                      Unpublish it — take this document down
                    </Label>
                  </div>
                </RadioGroup>
              </fieldset>

              {add.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  This document could not be added to that release.
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {add.isPending ? "Adding…" : "Add to release"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
