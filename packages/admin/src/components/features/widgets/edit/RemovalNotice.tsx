"use client";

/**
 * The notice a removal leaves behind: what was removed, and Undo.
 *
 * Bottom right, and the full width of a phone, where it covers the least of
 * the dashboard and stays clear of the page's own controls. It stays until the
 * reader closes it or the next removal replaces it -- a notice that timed out
 * would take Undo away from somebody still finding the button.
 *
 * Not a live region of its own. The grid's ONE region already said "<title>
 * removed.", and a second region speaking the same sentence would read it
 * twice; this is the control that acts on it, and it is reachable by Tab.
 *
 * @module components/features/widgets/edit/RemovalNotice
 */

import { Button } from "@nextlyhq/ui";
import { Undo2 } from "lucide-react";

import * as Icons from "@admin/components/icons";

export interface RemovalNoticeProps {
  /** The removed card's title, or nothing when no notice is showing. */
  title: string | undefined;
  /** Whether a layout write is in flight, which Undo waits for. */
  isWriting: boolean;
  /** Registers the Undo button, so focus can be sent to it. */
  undoRef: (element: HTMLElement | null) => void;
  onUndo: () => void;
  onClose: () => void;
}

export function RemovalNotice({
  title,
  isWriting,
  undoRef,
  onUndo,
  onClose,
}: RemovalNoticeProps) {
  if (title === undefined) return null;
  return (
    <div
      role="group"
      aria-label="Removed card"
      className="fixed inset-x-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground shadow-md sm:left-auto sm:max-w-sm"
      data-testid="removal-notice"
    >
      <span className="mr-auto min-w-0 truncate">{`${title} removed.`}</span>
      <Button
        ref={undoRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={onUndo}
        disabled={isWriting}
        // Names the card, so a reader who tabbed here from elsewhere knows
        // what Undo will put back.
        aria-label={`Undo removing ${title}`}
        data-testid="removal-notice-undo"
      >
        <Undo2 aria-hidden className="mr-1.5 size-4" />
        Undo
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onClose}
        aria-label="Close notice"
        data-testid="removal-notice-close"
      >
        <Icons.X aria-hidden className="size-4" />
      </Button>
    </div>
  );
}
