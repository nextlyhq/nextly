"use client";

/**
 * The preview control on the entry form.
 *
 * Two actions that look like one feature and are not: opening the preview uses
 * the editor's own session and can carry unsaved changes, while a shareable
 * link goes to someone with no session at all and can only show what was saved.
 * They are grouped because an author reaching for one is deciding between them,
 * not because they do the same thing.
 *
 * The shape adapts to what is actually available rather than showing disabled
 * controls, which say "you cannot do this" without saying why:
 *
 * - **Both** — one button with a menu. A fourth top-level button would crowd a
 *   narrow sidebar that already holds Preview, Cancel and Save.
 * - **Preview only** — exactly the button that was there before, unchanged.
 * - **Link only** — a single button, for a collection with no configured
 *   preview URL whose drafts can still be shared.
 * - **Neither** — nothing.
 *
 * @module components/entries/EntryForm/PreviewActions
 */

import { Button } from "@nextlyhq/ui";

import { ChevronDown, Eye, Link2, Loader2 } from "@admin/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@admin/components/ui";

export interface PreviewActionsProps {
  /** Whether the collection has a preview URL configured. */
  isPreviewAvailable?: boolean;
  /** Opens the preview in the editor's own session. */
  onPreview?: () => void;
  /** Label for the preview action. */
  previewLabel?: string;
  /**
   * Whether a shareable link can be minted. False for an unsaved entry, which
   * has no id to name, and for an author without `update` on the collection.
   */
  isLinkAvailable?: boolean;
  /** Mints a link and copies it. */
  onCopyLink?: () => void;
  /** Whether a link is being minted right now. */
  isCopyingLink?: boolean;
  /** Whether the surrounding form is submitting. */
  disabled?: boolean;
}

const COPY_LABEL = "Copy shareable link";

export function PreviewActions({
  isPreviewAvailable = false,
  onPreview,
  previewLabel = "Preview",
  isLinkAvailable = false,
  onCopyLink,
  isCopyingLink = false,
  disabled = false,
}: PreviewActionsProps) {
  const canPreview = isPreviewAvailable && onPreview !== undefined;
  const canCopy = isLinkAvailable && onCopyLink !== undefined;

  if (!canPreview && !canCopy) return null;

  if (canPreview && !canCopy) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={onPreview}
        disabled={disabled}
      >
        <Eye className="h-4 w-4" />
        {previewLabel}
      </Button>
    );
  }

  if (!canPreview && canCopy) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={onCopyLink}
        disabled={disabled || isCopyingLink}
      >
        {isCopyingLink ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Link2 className="h-4 w-4" />
        )}
        {COPY_LABEL}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          // The trigger opens a menu rather than performing the preview, so it
          // says so: a control labelled only "Preview" that opens a list is a
          // different promise than the one it keeps.
          aria-label={`${previewLabel} options`}
        >
          {isCopyingLink ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          {previewLabel}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {/*
         * Each item carries `disabled` itself rather than relying on the
         * trigger. The menu is uncontrolled, so a submit that begins while it
         * is already open leaves it open: disabling only the trigger would stop
         * the next opening and none of the actions inside the current one, and
         * both of these race the save they would run alongside.
         */}
        <DropdownMenuItem onSelect={onPreview} disabled={disabled}>
          <Eye className="h-4 w-4" />
          {previewLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onCopyLink}
          disabled={disabled || isCopyingLink}
        >
          <Link2 className="h-4 w-4" />
          {COPY_LABEL}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
