"use client";

/**
 * MediaDetailsPanel
 *
 * An item's details in a panel beside the grid, so a person can read one item
 * and still see, and click, the rest of the library. Where the library is too
 * narrow to hold both, the same panel slides over the grid as a sheet with its
 * own close button.
 *
 * - Beside the grid it is a region, not a dialog: nothing is trapped, the grid
 *   stays usable, and opening another tile shows that tile here.
 * - Over the grid it is the shared modal Sheet: focus stays inside it and
 *   Escape closes it.
 * - The left and right arrows, and the header's buttons, move to the previous
 *   and next item; Expand opens the full-screen viewer.
 *
 * The library owns which item is open and where focus returns on close; this
 * renders.
 */

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@nextlyhq/ui";
import * as React from "react";

import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
} from "@admin/components/icons";
import type { Media } from "@admin/types/media";

import {
  handleItemArrowKeys,
  MediaDetailsActions,
  MediaDetailsFields,
  MediaFileFacts,
  MediaPreview,
  type MediaDetailsActionHandlers,
  type MediaSave,
} from "../MediaDetails";
import { isFocalPointKeyEvent } from "../MediaFocalPoint";

/** Beside the grid, or over it where the library is too narrow for both. */
export type MediaDetailsPanelLayout = "beside" | "over";

/**
 * The width the panel takes beside the grid, and the narrowest library that
 * keeps it there. Below it the grid would be left a column or two, so the
 * panel goes over the grid instead.
 */
const MEDIA_DETAILS_PANEL_WIDTH = 380;
export const MEDIA_DETAILS_BESIDE_MIN_WIDTH = 860;

export interface MediaDetailsPanelProps extends MediaDetailsActionHandlers {
  media: Media;
  layout: MediaDetailsPanelLayout;
  /** The item's folder's name, or null for an item at the top level. */
  folderName: string | null;
  /** A reader sees the details with nothing to edit. */
  readOnly: boolean;
  onSave: MediaSave;
  /** Absent at the first item, which has nothing before it. */
  onPrevious?: () => void;
  /** Absent at the last item. */
  onNext?: () => void;
  onExpand: () => void;
  onClose: () => void;
}

export function MediaDetailsPanel({
  media,
  layout,
  folderName,
  readOnly,
  onSave,
  onPrevious,
  onNext,
  onExpand,
  onClose,
  ...actions
}: MediaDetailsPanelProps): React.JSX.Element {
  const titleRef = React.useRef<HTMLHeadingElement>(null);

  // Beside the grid, opening the panel moves focus to its title, so a person
  // who opened a tile from the keyboard is in the details at once. The panel
  // stays mounted from one item to the next, so this runs on opening only;
  // the sheet does the same through its own open event below.
  React.useEffect(() => {
    if (layout === "beside") titleRef.current?.focus();
  }, [layout]);

  const header = (
    <div className="flex items-center gap-1 border-b border-border px-3 py-2">
      {layout === "over" ? (
        <SheetTitle
          ref={titleRef}
          tabIndex={-1}
          className="mr-auto min-w-0 truncate text-sm font-semibold outline-none"
        >
          {media.originalFilename}
        </SheetTitle>
      ) : (
        <h2
          ref={titleRef}
          tabIndex={-1}
          className="mr-auto min-w-0 truncate text-sm font-semibold text-foreground outline-none"
        >
          {media.originalFilename}
        </h2>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Previous file"
        disabled={!onPrevious}
        onClick={onPrevious}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Next file"
        disabled={!onNext}
        onClick={onNext}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Expand to full screen"
        onClick={onExpand}
      >
        <Maximize2 className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Close details"
        onClick={onClose}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  const body = (
    <>
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <MediaPreview
          media={media}
          onSave={onSave}
          readOnly={readOnly}
          imageClassName="max-h-60"
        />
        <MediaDetailsFields media={media} onSave={onSave} readOnly={readOnly} />
        <MediaFileFacts media={media} folderName={folderName} />
      </div>
      <div className="border-t border-border p-3">
        <MediaDetailsActions media={media} {...actions} />
      </div>
    </>
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) =>
    handleItemArrowKeys(event, onPrevious, onNext);

  if (layout === "over") {
    return (
      <Sheet open onOpenChange={open => (open ? undefined : onClose())}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85dvh] flex-col gap-0 rounded-t-lg p-0"
          onKeyDown={onKeyDown}
          onOpenAutoFocus={event => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
          // The library returns focus to the tile of the item on screen, which
          // may not be the one that opened the sheet.
          onCloseAutoFocus={event => event.preventDefault()}
          onEscapeKeyDown={event => {
            if (isFocalPointKeyEvent(event)) event.preventDefault();
          }}
        >
          <SheetDescription className="sr-only">
            Details of {media.originalFilename}
          </SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      aria-label="Media details"
      data-media-details-panel=""
      onKeyDown={onKeyDown}
      // Sticks below the top of the page's scroll area, so the details stay in
      // view while the grid beside them scrolls.
      className="sticky top-4 flex max-h-[calc(100dvh-6rem)] shrink-0 flex-col self-start overflow-hidden rounded-lg border border-border bg-card"
      style={{ width: MEDIA_DETAILS_PANEL_WIDTH }}
    >
      {body}
    </aside>
  );
}
