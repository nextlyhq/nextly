"use client";

/**
 * The form editor's controls in the admin's one top bar, after the
 * breadcrumb: the status, the save state with Undo, the submissions count,
 * More, and Save, in the order an entry's bar puts its own.
 *
 * Drawn through `TopBarPlace`, so the controls stay in the editor's tree, with
 * its state, while they show in the bar.
 *
 * @module admin/components/editor/FormEditorBar
 */
import { TopBarPlace } from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Copy, Inbox, MoreHorizontal, Trash2, Undo2 } from "lucide-react";
import type { JSX } from "react";

import { followWithinAdmin } from "./form-editor-address";
import { FormStatusMenu, type FormStatus } from "./FormStatusMenu";

/** What the save state says: saving, how much is unsaved, or all saved. */
function saveStateText(changeCount: number, saving: boolean): string {
  if (saving) return "Saving…";
  if (changeCount === 0) return "All changes saved";
  return `${changeCount} unsaved change${changeCount === 1 ? "" : "s"}`;
}

export interface FormEditorBarProps {
  status: FormStatus;
  onStatusChange: (status: FormStatus) => void;
  /** Unsaved changes across every tab. */
  changeCount: number;
  saving: boolean;
  onUndo: () => void;
  /**
   * The form's submissions, and where its Submissions tab is; absent until
   * the form is saved and its count is known.
   */
  submissions?: { count: number; href: string };
  /** The form's ID (its slug), for Copy form ID. */
  formId: string;
  onCopyFormId: () => void;
  /** Delete the form, after asking; absent where it cannot be deleted. */
  onDelete?: () => void;
  onSave: () => void;
  /** Save cannot run now: nothing to save, a save is running, or it is held. */
  saveDisabled: boolean;
  /** Nothing in the form may change: a colleague holds it. */
  readOnly: boolean;
}

/**
 * The save state, as a live region so the count and "Saving…" are heard as
 * they change, and Undo while there is something to take back. The words
 * are hidden on a phone, where the Save button carries the state.
 */
function SaveState({
  changeCount,
  saving,
  canUndo,
  onUndo,
}: {
  changeCount: number;
  saving: boolean;
  canUndo: boolean;
  onUndo: () => void;
}): JSX.Element {
  return (
    <>
      <span
        role="status"
        className="hidden whitespace-nowrap text-sm text-muted-foreground sm:inline"
      >
        {saveStateText(changeCount, saving)}
      </span>
      {canUndo ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Undo"
          title="Undo the last change"
          onClick={onUndo}
        >
          <Undo2 aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
    </>
  );
}

/** The form's submission count, a link to its Submissions tab. */
function SubmissionsLink({
  count,
  href,
}: {
  count: number;
  href: string;
}): JSX.Element {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="hidden gap-1.5 px-2 md:inline-flex"
    >
      <a
        href={href}
        onClick={event => followWithinAdmin(event, href)}
        aria-label={`${count} submission${count === 1 ? "" : "s"}`}
        title="Open this form's submissions"
      >
        <Inbox aria-hidden="true" className="size-4" />
        <span className="tabular-nums">{count}</span>
      </a>
    </Button>
  );
}

/** More: Copy form ID, and Delete form where it can be deleted. */
function MoreMenu({
  formId,
  onCopyFormId,
  onDelete,
  deleteDisabled,
}: {
  formId: string;
  onCopyFormId: () => void;
  onDelete: (() => void) | undefined;
  deleteDisabled: boolean;
}): JSX.Element {
  return (
    // Not modal, as the status menu: see `FormStatusMenu`.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="More">
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onCopyFormId} disabled={formId === ""}>
          <Copy aria-hidden="true" className="size-4" />
          Copy form ID
        </DropdownMenuItem>
        {onDelete === undefined ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onDelete}
              disabled={deleteDisabled}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Delete form…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FormEditorBar({
  status,
  onStatusChange,
  changeCount,
  saving,
  onUndo,
  submissions,
  formId,
  onCopyFormId,
  onDelete,
  onSave,
  saveDisabled,
  readOnly,
}: FormEditorBarProps): JSX.Element {
  const busy = readOnly || saving;
  return (
    <TopBarPlace name="end">
      <div
        data-slot="form-editor-bar"
        className="ml-auto flex min-w-0 items-center gap-2"
      >
        <FormStatusMenu
          status={status}
          onChange={onStatusChange}
          disabled={busy}
        />
        <SaveState
          changeCount={changeCount}
          saving={saving}
          canUndo={changeCount > 0 && !busy}
          onUndo={onUndo}
        />
        <span
          aria-hidden="true"
          className="mx-1 hidden h-5 w-px bg-border sm:block"
        />
        {submissions === undefined ? null : (
          <SubmissionsLink count={submissions.count} href={submissions.href} />
        )}
        <MoreMenu
          formId={formId}
          onCopyFormId={onCopyFormId}
          onDelete={onDelete}
          deleteDisabled={busy}
        />
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={saveDisabled}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </TopBarPlace>
  );
}
