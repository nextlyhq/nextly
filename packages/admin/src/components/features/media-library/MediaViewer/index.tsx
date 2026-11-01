"use client";

/**
 * MediaViewer
 *
 * An item full screen, for a closer look at the image itself, opened by the
 * details panel's Expand. Previous and next by the arrow keys and the
 * buttons beside the image, the same details beside it (Info hides them), and
 * Escape back to the panel, with focus returned to the control that opened it.
 *
 * Built on the shared modal Dialog, so focus stays inside while it is open.
 * Its colours are the admin's tokens, so it follows the light or dark scheme
 * like the rest of the admin.
 */

import { Button, Dialog, DialogContent, DialogTitle } from "@nextlyhq/ui";
import * as React from "react";

import { ChevronLeft, ChevronRight, Info } from "@admin/components/icons";
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

/**
 * Below Tailwind's `md`, where the layout below stacks the details under the
 * image instead of beside it.
 */
const VIEWER_STACKED_QUERY = "(max-width: 47.99rem)";

export interface MediaViewerProps extends MediaDetailsActionHandlers {
  open: boolean;
  media: Media;
  folderName: string | null;
  readOnly: boolean;
  onSave: MediaSave;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
}

export function MediaViewer({
  open,
  media,
  folderName,
  readOnly,
  onSave,
  onPrevious,
  onNext,
  onClose,
  ...actions
}: MediaViewerProps): React.JSX.Element {
  const [infoOpen, setInfoOpen] = React.useState(true);
  // The control that opened the viewer. The Dialog is opened by state rather
  // than by a trigger of its own, so Radix has nothing to return focus to on
  // close; this is that something.
  const openerRef = React.useRef<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    if (document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    // Info starts open where the details sit beside the image, and closed
    // where they would stack under it: on a phone they would push the image
    // to a strip at the top of a viewer opened to look at the image.
    setInfoOpen(!window.matchMedia?.(VIEWER_STACKED_QUERY).matches);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={next => (next ? undefined : onClose())}>
      <DialogContent
        size="full"
        aria-describedby={undefined}
        // The whole window: the shared dialog centres a card, and a viewer
        // wants every pixel for the picture.
        className="inset-0 left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto rounded-none border-0 p-0 sm:max-w-none data-[state=closed]:animate-none data-[state=open]:animate-none"
        onKeyDown={event => handleItemArrowKeys(event, onPrevious, onNext)}
        onEscapeKeyDown={event => {
          if (isFocalPointKeyEvent(event)) event.preventDefault();
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          const opener = openerRef.current;
          if (opener?.isConnected) opener.focus();
        }}
      >
        {/* Room on the right for the dialog's own close button. */}
        <div className="flex items-center gap-2 border-b border-border py-2 pl-4 pr-14">
          <DialogTitle className="mr-auto min-w-0 truncate text-base font-semibold">
            {media.originalFilename}
          </DialogTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            aria-pressed={infoOpen}
            onClick={() => setInfoOpen(value => !value)}
          >
            <Info className="h-4 w-4" aria-hidden="true" />
            Info
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Previous and Next sit at the image's sides where there is room
              for them, and in the bottom corners on a phone, so the image
              takes the screen's whole width rather than what two buttons
              beside it leave. */}
          <div className="relative flex min-h-[50dvh] min-w-0 flex-1 items-center justify-center bg-muted px-4 pb-16 pt-4 md:min-h-0 md:px-14 md:py-4">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Previous file"
              disabled={!onPrevious}
              onClick={onPrevious}
              className="absolute bottom-3 left-3 md:bottom-auto md:top-1/2 md:-translate-y-1/2"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <div className="w-full max-w-full">
              <MediaPreview
                media={media}
                onSave={onSave}
                readOnly={readOnly}
                imageClassName="max-h-[calc(100dvh-11rem)]"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Next file"
              disabled={!onNext}
              onClick={onNext}
              className="absolute bottom-3 right-3 md:bottom-auto md:top-1/2 md:-translate-y-1/2"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          {infoOpen && (
            <aside
              aria-label="Media details"
              className="flex w-full shrink-0 flex-col gap-5 border-t border-border bg-background p-4 md:w-[360px] md:overflow-y-auto md:border-l md:border-t-0"
            >
              <MediaDetailsFields
                media={media}
                onSave={onSave}
                readOnly={readOnly}
              />
              <MediaFileFacts media={media} folderName={folderName} />
              <MediaDetailsActions media={media} {...actions} />
            </aside>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
