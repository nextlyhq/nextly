"use client";

/**
 * The top of a release's page: its title and description, editable in place
 * by someone who may rename it; where it stands and when it runs; and the
 * actions the reader may take on it.
 *
 * The actions are the row menu's, offered from the same list under the same
 * names (`releaseActionsFor`), so the list and the page never disagree about
 * what can be done to a release. Scheduling and Publish now are buttons, as
 * the two acts the page exists for; calling a release off and deleting it sit
 * behind its menu.
 *
 * @module components/features/releases/ReleasePageHeader
 */

import { useState, type FormEvent, type KeyboardEvent } from "react";

import {
  CalendarClock,
  FileText,
  Globe,
  MoreHorizontal,
  Pencil,
} from "@admin/components/icons";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Textarea,
} from "@admin/components/ui";
import { useUpdateRelease } from "@admin/hooks/queries/useReleases";
import { cn } from "@admin/lib/utils";
import type { Release } from "@admin/types/releases";

import { releaseErrorMessage } from "./release-error";
import type { ReleaseRowStatus } from "./release-list";
import { releaseWhenLine } from "./release-page";
import { ReleaseStatusBadge } from "./ReleaseListCells";
import type { ReleaseRowAction } from "./ReleaseRowActionDialog";
import { releaseActionsFor, type OpenDialog } from "./ReleaseRowMenu";

/** The acts drawn as buttons; the rest of what is offered sits in the menu. */
const BUTTON_ACTIONS = new Set<ReleaseRowAction | "schedule">([
  "schedule",
  "publish",
]);

/** Which of the title and the description is being edited, if either. */
type Editing = "title" | "description" | null;

export function ReleasePageHeader({
  release,
  readerZone,
  now,
  status,
  commitBlockedReason,
  onOpenDialog,
}: {
  release: Release;
  readerZone: string;
  now: number;
  /**
   * Where the release stands in the list's words, or `null` while that is
   * not known, when no state is claimed at all, as the calendar does.
   */
  status: ReleaseRowStatus | null;
  /**
   * Why the release cannot be scheduled or published now, from its checks,
   * or `null` when nothing stops it. The server refuses both while a hard
   * problem stands, so they are not offered as if they would work.
   */
  commitBlockedReason: string | null;
  onOpenDialog: (dialog: OpenDialog) => void;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const mayEdit = release.can?.update === true;
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 flex-1">
        {editing === "title" ? (
          <TitleEditor release={release} onDone={() => setEditing(null)} />
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-foreground">
              {release.title}
            </h1>
            {mayEdit ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label="Rename release"
                onClick={() => setEditing("title")}
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
            ) : null}
          </div>
        )}

        <WhenLine
          release={release}
          readerZone={readerZone}
          now={now}
          status={status}
        />

        {editing === "description" ? (
          <DescriptionEditor
            release={release}
            onDone={() => setEditing(null)}
          />
        ) : (
          <DescriptionLine
            description={release.description}
            mayEdit={mayEdit}
            onEdit={() => setEditing("description")}
          />
        )}
      </div>

      <HeaderActions
        release={release}
        blockedReason={commitBlockedReason}
        onOpenDialog={onOpenDialog}
      />
    </header>
  );
}

/**
 * When the release runs or ran, in the reader's time, with the time it was
 * scheduled for where that clock reads differently, and how far away it is.
 */
function WhenLine({
  release,
  readerZone,
  now,
  status,
}: {
  release: Release;
  readerZone: string;
  now: number;
  status: ReleaseRowStatus | null;
}) {
  const { lead, time } = releaseWhenLine(release, { readerZone, now }, status);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
      {status ? <ReleaseStatusBadge status={status} /> : null}
      {release.kind === "single" ? (
        <span className="inline-flex h-[22px] items-center gap-1 rounded-sm border border-border px-1.5 text-xs text-muted-foreground">
          <FileText className="size-3" aria-hidden />
          Single document
        </span>
      ) : null}
      <CalendarClock className="ml-1 size-4 shrink-0" aria-hidden />
      {time ? (
        <>
          <span>
            {lead}{" "}
            <strong className="font-medium tabular-nums text-foreground">
              {time.local}
            </strong>
            {time.scheduled ? " your time" : null}
          </span>
          {time.scheduled ? (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden>·</span>
              <Globe className="size-3.5 shrink-0" aria-hidden />
              {time.scheduled.text} {time.scheduled.zone} (as scheduled)
            </span>
          ) : null}
          <span>
            <span aria-hidden>· </span>
            {time.relative}
          </span>
        </>
      ) : (
        <span>{lead}</span>
      )}
    </div>
  );
}

function DescriptionLine({
  description,
  mayEdit,
  onEdit,
}: {
  description: string | null;
  mayEdit: boolean;
  onEdit: () => void;
}) {
  if (description) {
    return (
      <div className="mt-3 flex max-w-3xl items-start gap-1">
        <p className="whitespace-pre-line text-sm text-foreground/90">
          {description}
        </p>
        {mayEdit ? (
          <Button
            variant="ghost"
            size="icon"
            className="-mt-1 size-7 shrink-0 text-muted-foreground"
            aria-label="Edit description"
            onClick={onEdit}
          >
            <Pencil className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
    );
  }
  if (!mayEdit) return null;
  return (
    <Button
      variant="link"
      className="mt-2 h-auto p-0 text-sm text-muted-foreground"
      onClick={onEdit}
    >
      Add a description
    </Button>
  );
}

/** Enter saves a one-line field and Escape leaves it, as a form would. */
function cancelOnEscape(onCancel: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };
}

function TitleEditor({
  release,
  onDone,
}: {
  release: Release;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(release.title);
  const update = useUpdateRelease(release.id);
  const trimmed = title.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === "" || update.isPending) return;
    // A title that did not change is no rename: nothing is sent.
    if (trimmed === release.title) return onDone();
    update.mutate({ title: trimmed }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Release name"
          value={title}
          autoFocus
          onChange={event => setTitle(event.target.value)}
          onKeyDown={cancelOnEscape(onDone)}
          className="h-10 min-w-0 flex-1 text-lg font-semibold"
          aria-invalid={trimmed === "" || undefined}
        />
        <Button type="submit" disabled={trimmed === "" || update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {trimmed === "" ? (
        <p className="text-sm text-destructive-700 dark:text-destructive">
          A release needs a name.
        </p>
      ) : null}
      {update.isError ? (
        <p
          role="alert"
          className="text-sm text-destructive-700 dark:text-destructive"
        >
          {releaseErrorMessage(update.error, "The release was not renamed.")}
        </p>
      ) : null}
    </form>
  );
}

function DescriptionEditor({
  release,
  onDone,
}: {
  release: Release;
  onDone: () => void;
}) {
  const [description, setDescription] = useState(release.description ?? "");
  const update = useUpdateRelease(release.id);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (update.isPending) return;
    // An emptied description clears it, as the server reads `null`.
    const next = description.trim() === "" ? null : description;
    if (next === release.description) return onDone();
    update.mutate({ description: next }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="mt-3 flex max-w-2xl flex-col gap-2">
      <Textarea
        aria-label="Release description"
        value={description}
        autoFocus
        rows={3}
        onChange={event => setDescription(event.target.value)}
        onKeyDown={cancelOnEscape(onDone)}
        placeholder="What this release is for"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {update.isError ? (
        <p
          role="alert"
          className="text-sm text-destructive-700 dark:text-destructive"
        >
          {releaseErrorMessage(
            update.error,
            "The description was not changed."
          )}
        </p>
      ) : null}
    </form>
  );
}

/** Scheduling and Publish now as buttons; calling it off and deleting in its menu. */
function HeaderActions({
  release,
  blockedReason,
  onOpenDialog,
}: {
  release: Release;
  blockedReason: string | null;
  onOpenDialog: (dialog: OpenDialog) => void;
}) {
  const offers = releaseActionsFor(release);
  const buttons = offers.filter(offer => BUTTON_ACTIONS.has(offer.id));
  const menu = offers.filter(offer => !BUTTON_ACTIONS.has(offer.id));
  if (offers.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col items-start gap-1.5 md:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {buttons.map(offer => (
          <Button
            key={offer.id}
            variant={offer.id === "publish" ? "default" : "outline"}
            disabled={blockedReason !== null}
            aria-describedby={
              blockedReason !== null ? "release-commit-blocked" : undefined
            }
            onClick={() => onOpenDialog({ release, action: offer.id })}
          >
            {offer.id === "schedule" ? (
              <CalendarClock className="size-4" aria-hidden />
            ) : null}
            {offer.label}
          </Button>
        ))}
        {menu.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="More release actions"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menu.map(offer => (
                <DropdownMenuItem
                  key={offer.id}
                  onSelect={() => onOpenDialog({ release, action: offer.id })}
                  className={cn(
                    offer.destructive &&
                      "text-destructive-700 dark:text-destructive"
                  )}
                >
                  {offer.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {blockedReason !== null && buttons.length > 0 ? (
        <p
          id="release-commit-blocked"
          className="max-w-xs text-xs text-muted-foreground md:text-right"
        >
          {blockedReason}
        </p>
      ) : null}
    </div>
  );
}
