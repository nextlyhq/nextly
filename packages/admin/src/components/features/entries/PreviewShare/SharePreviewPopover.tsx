"use client";

/**
 * The share popover, anchored to whatever the surface holding it chooses.
 *
 * The anchor is the caller's because the control that opens the popover is not
 * always on screen: on a narrow header the preview control folds into the
 * document's menu, and a popover anchored to a hidden element has nowhere to
 * appear. So each surface anchors it to something it keeps visible, and the
 * preview control and the menu row both simply open it.
 *
 * The panel mounts only while open, so the live list is read when an editor
 * looks at it rather than on every page that could share.
 *
 * @module components/features/entries/PreviewShare/SharePreviewPopover
 */

import type { JSX, ReactNode } from "react";

import { Popover, PopoverAnchor, PopoverContent } from "@admin/components/ui";
import type { PreviewLinkDocument } from "@admin/services/previewLinkApi";

import { SharePreviewPanel } from "./SharePreviewPanel";

export interface SharePreviewPopoverProps {
  /** The one document whose links are shared and listed. */
  document: PreviewLinkDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the popover hangs from: a single element that stays on screen. */
  children: ReactNode;
}

export function SharePreviewPopover({
  document,
  open,
  onOpenChange,
  children,
}: SharePreviewPopoverProps): JSX.Element {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align="end"
        // Wide enough for a row of maker, end and count beside Revoke; never
        // wider than a phone's screen less its gutter.
        // Never taller than the room below or above the anchor: on a phone the
        // list and its revoke-all would otherwise run off the screen, out of
        // reach, since a popover does not scroll the page.
        className="max-h-[var(--radix-popover-content-available-height)] w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
        aria-label="Share a preview"
        // Not closed by focus moving elsewhere. It is opened from a menu row as
        // often as from a button, and a closing menu hands focus back to its
        // trigger, which would close the popover the moment it opened. Escape,
        // a click outside and the panel's own Close button all still close it.
        onFocusOutside={event => event.preventDefault()}
      >
        {open ? (
          <SharePreviewPanel
            document={document}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
