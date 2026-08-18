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

import { ToolbarLabel } from "./toolbar-density";

export interface PreviewActionsProps {
  /** Whether the collection has a preview URL configured. */
  isPreviewAvailable?: boolean;
  /**
   * Opens the preview in the editor's own session.
   *
   * May return a promise: resolving the URL can require a round trip. Nothing
   * here treats the handler returning as the preview having opened, so an
   * asynchronous implementation needs no change on this side.
   */
  onPreview?: () => void | Promise<void>;
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
  /**
   * The button height, matching whichever action row this sits in. The two
   * rows disagree: the standalone editor's header is a band of `sm` controls,
   * while the embedded form's footer uses the default. A control that keeps
   * one height in both is the wrong height in one of them, and a button a few
   * pixels taller than the Save beside it reads as a mistake rather than as a
   * distinction.
   */
  size?: "default" | "sm";
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
  size = "default",
}: PreviewActionsProps) {
  const canPreview = isPreviewAvailable && onPreview !== undefined;
  const canCopy = isLinkAvailable && onCopyLink !== undefined;

  /**
   * Adapts a possibly-asynchronous handler to the void-returning slot a DOM
   * event expects.
   *
   * Handing the promise straight to `onClick` makes a rejection invisible,
   * which is what forbids it. It is not this control's to report either: it
   * knows the action failed and nothing about why, so anything it rendered
   * would be a second, vaguer error beside the handler's own. Discarding the
   * value leaves a rejection to the runtime's unhandled-rejection reporting,
   * where it stays visible without being claimed here.
   */
  const startPreview =
    onPreview === undefined
      ? undefined
      : () => {
          void onPreview();
        };

  if (!canPreview && !canCopy) return null;

  if (canPreview && !canCopy) {
    return (
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={startPreview}
        disabled={disabled}
        title={previewLabel}
      >
        <Eye className="h-4 w-4" />
        <ToolbarLabel priority="secondary">{previewLabel}</ToolbarLabel>
      </Button>
    );
  }

  if (!canPreview && canCopy) {
    return (
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={onCopyLink}
        disabled={disabled || isCopyingLink}
        title={COPY_LABEL}
      >
        {isCopyingLink ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Link2 className="h-4 w-4" />
        )}
        <ToolbarLabel priority="secondary">{COPY_LABEL}</ToolbarLabel>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={disabled}
          // The trigger opens a menu rather than performing the preview, so it
          // says so: a control labelled only "Preview" that opens a list is a
          // different promise than the one it keeps.
          aria-label={`${previewLabel} options`}
          title={`${previewLabel} options`}
        >
          {isCopyingLink ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          <ToolbarLabel priority="secondary">{previewLabel}</ToolbarLabel>
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
        <DropdownMenuItem onSelect={startPreview} disabled={disabled}>
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
