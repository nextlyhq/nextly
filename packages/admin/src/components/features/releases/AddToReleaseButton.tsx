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

import { releaseErrorMessage } from "./release-error";
import { describeRelease } from "./release-schedule";

/**
 * Choosing the release, with its schedule shown beneath.
 *
 * The schedule is rendered in the same words the release pages use, so an
 * editor confirms WHEN before they confirm what — the whole risk of this dialog
 * is adding a document to a launch that fires sooner than they think.
 */
function ReleasePicker({
  releaseId,
  onChange,
  isPending,
  items,
  truncated,
}: {
  releaseId: string;
  onChange: (next: string) => void;
  isPending: boolean;
  items: Release[];
  truncated: boolean;
}) {
  const chosen = items.find(release => release.id === releaseId);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="target-release">Release</Label>
      <Select value={releaseId} onValueChange={onChange}>
        <SelectTrigger id="target-release">
          <SelectValue
            placeholder={isPending ? "Loading releases…" : "Choose a release"}
          />
        </SelectTrigger>
        <SelectContent>
          {items.map(release => (
            <SelectItem key={release.id} value={release.id}>
              {release.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {chosen ? (
        <p className="text-sm text-muted-foreground">
          {describeRelease(chosen)}
        </p>
      ) : null}
      {truncated ? (
        <p className="text-sm text-muted-foreground">
          Only the most recent releases are listed.
        </p>
      ) : null}
    </div>
  );
}

export interface AddToReleaseButtonProps {
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
  /**
   * Whether this document type HAS a publish lifecycle.
   *
   * A release member performs a publish or unpublish, and the route refuses a
   * document whose schema declares no lifecycle at all. `useCan` answers true
   * for the synthetic `publish-<slug>` check regardless, so a super-admin
   * editing a collection with `status` disabled would otherwise be offered a
   * control whose every submission is rejected.
   */
  lifecycleEnabled: boolean;
  /**
   * Whether the editor is on the document's DEFAULT locale.
   *
   * A member is whole-document: the service refuses a locale-scoped one
   * outright, so adding from a translation would schedule every locale while
   * every other control on that screen acts on the one being edited. The
   * control is withheld rather than silently widened.
   */
  onDefaultLocale: boolean;
}

/**
 * Which releases are worth OFFERING as a target.
 *
 * The server says which ones this caller may add to — state and authority
 * together — so this filters on `can.addMember` rather than reasoning about
 * either. What remains here is a presentation decision the server has no view
 * on: a CANCELLED release is addable and is not offered, because nothing put in
 * one would ever go live and listing it invites an editor to believe they have
 * scheduled something. Rescheduling it first makes it an ordinary target, so
 * nothing is unreachable — only the pointless order of operations is.
 *
 * Asked as two narrow queries rather than one wide one. The list is ordered by
 * instant descending with nulls LAST, so drafts — the usual target — sort behind
 * every scheduled and published release and would fall outside an unfiltered
 * first window on any site with a history.
 */
function useAssemblableReleases(enabled: boolean) {
  // Not fetched until the dialog is open AND the caller may read releases.
  // These are protected endpoints, so mounting them unconditionally made every
  // editor visit by an unentitled user issue two 403s — six, once the retry
  // policy is counted — for a control that then renders nothing.
  const queries = [
    useReleases({ state: "draft" }, enabled),
    useReleases({ state: "scheduled" }, enabled),
  ];

  return {
    items: queries
      .flatMap(query => query.data?.items ?? [])
      .filter(release => release.can?.addMember === true),
    isPending: queries.some(query => query.isPending),
    isError: queries.some(query => query.isError),
    truncated: queries.some(query => query.data?.meta.hasNext === true),
  };
}

export function AddToReleaseButton({
  scopeKind,
  scopeSlug,
  entryId,
  lifecycleEnabled,
  onDefaultLocale,
}: AddToReleaseButtonProps) {
  const canAssemble = useCan("create-content-releases");
  // The picker reads `/api/releases`, which is gated. Asked separately from
  // `canAssemble` because the two are different questions and the query must
  // not fire for someone who holds neither.
  const canRead = useCan("read-content-releases");
  // The DOCUMENT's own lifecycle grants, which `addMember` requires in addition
  // to the release authority — scheduling a publish must not become a way to
  // perform a write the caller could not perform now. Without these the dialog
  // offers both actions to an assembler who holds neither, and the only thing
  // they learn is that it failed.
  const canPublishDocument = useCan(`publish-${scopeSlug}`);
  const canUnpublishDocument = useCan(`unpublish-${scopeSlug}`);
  const [open, setOpen] = useState(false);
  const [releaseId, setReleaseId] = useState("");
  // Defaulted to whichever the caller can actually perform, so the dialog does
  // not open on a disabled choice.
  const [action, setAction] = useState<ReleaseMemberAction>(
    canPublishDocument ? "publish" : "unpublish"
  );
  const releases = useAssemblableReleases(open && canRead);
  const add = useAddReleaseMember(releaseId);

  // Assembling authority alone is not enough to do anything here: every member
  // performs a lifecycle write on THIS document, so a caller who can neither
  // publish nor unpublish it has no action to schedule.
  if (!canAssemble || (!canPublishDocument && !canUnpublishDocument)) {
    return null;
  }
  // Withheld where the write would be refused or would mean more than it looks
  // like it means. Both are decisions the caller supplies, because only the
  // editor around this control knows them.
  if (!lifecycleEnabled || !onDefaultLocale) return null;

  // ONE close path. The visible Cancel button called the setter directly, so it
  // skipped the reset that lives in `onOpenChange` — and this dialog stays
  // mounted, so reopening restored a name the editor had discarded along with
  // any error from the last attempt.
  const close = () => {
    setReleaseId("");
    // Back to whichever action the caller can actually perform, not "publish":
    // reopening on a disabled choice leaves submission dead until they notice.
    setAction(canPublishDocument ? "publish" : "unpublish");
    add.reset();
    setOpen(false);
  };

  const permitted =
    action === "publish" ? canPublishDocument : canUnpublishDocument;
  const canSubmit = Boolean(releaseId) && permitted && !add.isPending;

  return (
    <>
      {/* EXPLICITLY not a submit. This control is rendered inside the editor's
          own `<form>`, and a `<button>` without a type defaults to `submit` —
          so opening this dialog would also save the document, publishing dirty
          fields before anybody had chosen a release. The trigger says what it
          is rather than relying on where it happens to be mounted. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <CalendarClock className="mr-1.5 size-4" aria-hidden />
        Add to release
      </Button>

      <Dialog
        open={open}
        onOpenChange={next => {
          if (!next) close();
          else setOpen(true);
        }}
      >
        <DialogContent>
          <form
            onSubmit={event => {
              event.preventDefault();
              if (!canSubmit) return;
              add.mutate(
                { scopeKind, scopeSlug, entryId, action },
                { onSuccess: close }
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
                <ReleasePicker
                  releaseId={releaseId}
                  onChange={setReleaseId}
                  isPending={releases.isPending}
                  items={releases.items}
                  truncated={releases.truncated}
                />
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
                    <RadioGroupItem
                      value="publish"
                      id="release-publish"
                      disabled={!canPublishDocument}
                    />
                    <Label htmlFor="release-publish" className="font-normal">
                      Publish it — make this document live
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="unpublish"
                      id="release-unpublish"
                      disabled={!canUnpublishDocument}
                    />
                    <Label htmlFor="release-unpublish" className="font-normal">
                      Unpublish it — take this document down
                    </Label>
                  </div>
                </RadioGroup>
              </fieldset>

              {add.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {releaseErrorMessage(
                    add.error,
                    "This document could not be added to that release."
                  )}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
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
