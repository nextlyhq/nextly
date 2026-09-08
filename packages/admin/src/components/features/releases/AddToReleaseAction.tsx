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
 * @module components/features/releases/AddToReleaseAction
 */

import type { ReactNode } from "react";
import { useState } from "react";

import type { ContributedAction } from "@admin/components/features/entries/EntryForm/DocumentActionBar";
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

/**
 * What the editor needs to offer this: the action to place, and the dialog it
 * opens. Both, because a caller given only the action would place a control
 * that opens nothing.
 */
/**
 * Why adding to a release is refused for THIS document, or undefined when it
 * is not.
 *
 * Pure, and outside the hook, so the rule can be read and tested without a
 * render — and so the hook stops carrying a nested conditional whose branches
 * each needed a comment. Order matters: a caller who cannot perform the write
 * at all is told that first, because switching to the default locale would not
 * help them.
 */
export function releaseRefusal(document: {
  canPublish: boolean;
  canUnpublish: boolean;
  onDefaultLocale: boolean;
}): string | undefined {
  if (!document.canPublish && !document.canUnpublish) {
    return "You do not have permission to publish or unpublish this document.";
  }
  /*
   * A member is whole-document: the service refuses a locale-scoped one, so
   * adding from a translation would schedule every locale while every other
   * control on the screen acts on the one being edited.
   */
  if (!document.onDefaultLocale) {
    return "Add to a release from the document's default locale.";
  }
  return undefined;
}

export interface AddToReleaseAction {
  /** The action to contribute, or null when it does not apply at all. */
  contributed: ContributedAction | null;
  /** The dialog to mount, or null when there is no action. */
  dialog: ReactNode;
}

export interface AddToReleaseProps {
  scopeKind: "collection" | "single";
  /**
   * The document being edited, as the page holds it — which is to say possibly
   * not yet loaded.
   *
   * Optional so a caller does not default them. This hook has to be called
   * above a page's loading and error returns, where the document may not have
   * arrived, and every caller writing `slug ?? ""` was a branch in the page
   * restating a question this module already answers.
   */
  scopeSlug: string | undefined;
  entryId: string | undefined;
  /**
   * Whether this document type HAS a publish lifecycle.
   *
   * A release member performs a publish or unpublish, and the route refuses a
   * document whose schema declares no lifecycle at all. `useCan` answers true
   * for the synthetic `publish-<slug>` check regardless, so a super-admin
   * editing a collection with `status` disabled would otherwise be offered a
   * control whose every submission is rejected.
   */
  lifecycleEnabled: boolean | undefined;
  /**
   * Whether the editor is on the document's DEFAULT locale.
   *
   * A member is whole-document: the service refuses a locale-scoped one
   * outright, so adding from a translation would schedule every locale while
   * every other control on that screen acts on the one being edited.
   *
   * False therefore OFFERS the action carrying a reason, rather than widening
   * the write or removing the control. The way out is something the author can
   * act on — switch to the default locale — which an absent control cannot say.
   */
  onDefaultLocale: boolean;
}

/**
 * The picker itself, and everything that only matters once it is open.
 *
 * Its own component rather than JSX inside the hook, because the two answer
 * different questions and were being read as one. The hook answers WHETHER this
 * document can be added to a release and says why not; this answers what
 * choosing a release looks like. Keeping the form's state here also means a
 * page that never opens the picker never mounts any of it.
 */

/**
 * What the release should DO to this document when it goes out.
 *
 * Its own component because the choice is gated by two separate grants and each
 * option carries its own disabled state — several branches that have nothing to
 * do with choosing a release, which is what the dialog around it is for.
 */
function ReleaseActionChoice({
  action,
  onChange,
  canPublishDocument,
  canUnpublishDocument,
}: {
  action: ReleaseMemberAction;
  onChange: (next: ReleaseMemberAction) => void;
  canPublishDocument: boolean;
  canUnpublishDocument: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">What should happen</legend>
      <RadioGroup
        value={action}
        onValueChange={next => onChange(next as ReleaseMemberAction)}
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
  );
}

/**
 * The picker's own state, and the rules about whether it can be submitted.
 *
 * Separated from the dialog because they are the parts with branches in them —
 * which release is chosen, which action the caller may actually perform, when
 * the whole thing may be sent — while what is left is a form to look at. It
 * also puts the ONE close path somewhere a future control cannot route around
 * by calling a setter directly.
 */
function useReleaseDraft({
  open,
  canRead,
  canPublishDocument,
  canUnpublishDocument,
  onOpenChange,
}: {
  open: boolean;
  canRead: boolean;
  canPublishDocument: boolean;
  canUnpublishDocument: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [releaseId, setReleaseId] = useState("");
  // Defaulted to whichever the caller can actually perform, so the dialog does
  // not open on a disabled choice.
  const [action, setAction] = useState<ReleaseMemberAction>(
    canPublishDocument ? "publish" : "unpublish"
  );
  const releases = useAssemblableReleases(open && canRead);
  const add = useAddReleaseMember(releaseId);

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
    onOpenChange(false);
  };

  const permitted =
    action === "publish" ? canPublishDocument : canUnpublishDocument;
  const canSubmit = Boolean(releaseId) && permitted && !add.isPending;

  return {
    releaseId,
    setReleaseId,
    action,
    setAction,
    releases,
    add,
    close,
    canSubmit,
  };
}

function AddToReleaseDialog({
  open,
  onOpenChange,
  scopeKind,
  scopeSlug,
  entryId,
  canRead,
  canPublishDocument,
  canUnpublishDocument,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
  canRead: boolean;
  canPublishDocument: boolean;
  canUnpublishDocument: boolean;
}) {
  const {
    releaseId,
    setReleaseId,
    action,
    setAction,
    releases,
    add,
    close,
    canSubmit,
  } = useReleaseDraft({
    open,
    canRead,
    canPublishDocument,
    canUnpublishDocument,
    onOpenChange,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) close();
        else onOpenChange(true);
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

            <ReleaseActionChoice
              action={action}
              onChange={setAction}
              canPublishDocument={canPublishDocument}
              canUnpublishDocument={canUnpublishDocument}
            />

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
  );
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

export function useAddToReleaseAction({
  scopeKind,
  scopeSlug,
  entryId,
  lifecycleEnabled,
  onDefaultLocale,
}: AddToReleaseProps): AddToReleaseAction {
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
  /*
   * Which DOCUMENT the picker is open for, rather than whether it is open.
   *
   * This hook is called from the page, and the router renders the same page
   * component for every entry of a route without a key — so navigating from one
   * document to another keeps this state alive. A plain boolean would survive
   * that move and the picker would reappear over a document nobody opened it
   * for, aimed at the new one.
   *
   * Scoping the state to the document makes that unrepresentable rather than
   * cleaning up after it: an identity from another document simply is not open,
   * with no effect to fire and nothing to forget on a later route.
   */
  const documentKey = `${scopeKind}:${scopeSlug}:${entryId}`;
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === documentKey;
  const setOpen = (next: boolean) => setOpenFor(next ? documentKey : null);

  /*
   * EXISTENCE is decided by authority over the feature; USABILITY by facts
   * about this document. The split matters, and it is why two of these four
   * conditions changed from withholding the control to explaining it.
   *
   * A caller who may not assemble releases at all, or a document type with no
   * publish lifecycle, has nothing here worth naming: the first has no business
   * with releases anywhere in the admin, and the second has no lifecycle write
   * for a member to perform. Those stay absent.
   *
   * The other two are about THIS document, and an absent control cannot be
   * distinguished from a feature that does not exist. An author lacking the
   * document's own publish grants, or editing a translation, previously saw
   * nothing at all and had no way to learn why — so those now appear, disabled,
   * carrying the reason.
   */
  // `scopeSlug` and `entryId` are absent while the page is still loading, and a
  // member needs both to name what it is scheduling.
  if (!canAssemble || lifecycleEnabled !== true || !scopeSlug || !entryId) {
    return { contributed: null, dialog: null };
  }

  const disabledReason = releaseRefusal({
    canPublish: canPublishDocument,
    canUnpublish: canUnpublishDocument,
    onDefaultLocale,
  });

  /*
   * A DESCRIPTION and the handler that runs it, for the editor's action model
   * to place. This module renders no trigger, which is what lets the model put
   * the action in the overflow menu beside Duplicate; a component drawing its
   * own button decides that itself and cannot be told otherwise.
   *
   * It also keeps the control out of the editor's `<form>`. A `<button>` with
   * no `type` inside a form defaults to `submit`, so a trigger mounted there
   * saves the document — publishing dirty fields — merely by being clicked. A
   * menu item is outside the form and runs a callback.
   */
  const contributed: ContributedAction = {
    action: {
      id: "add-to-release",
      label: "Add to release",
      placement: "menu",
      group: "document",
      ...(disabledReason === undefined ? {} : { disabledReason }),
    },
    binding: { onSelect: () => setOpen(true) },
  };

  const dialog = (
    <AddToReleaseDialog
      open={open}
      onOpenChange={setOpen}
      scopeKind={scopeKind}
      scopeSlug={scopeSlug}
      entryId={entryId}
      canRead={canRead}
      canPublishDocument={canPublishDocument}
      canUnpublishDocument={canUnpublishDocument}
    />
  );

  return { contributed, dialog };
}
