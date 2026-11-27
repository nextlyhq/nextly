"use client";

/**
 * The Inbox button at the rail's foot: a tray icon with the person's unread
 * count, named "Inbox", or "Inbox, 3 unread" while items are unread, and the
 * popover it opens.
 *
 * Every admin user has one. The count is the server's: it is read once on a
 * page load, again when the admin's browser tab regains focus and every minute
 * while it is visible, so it agrees on every browser and device. Nothing else
 * is read until the Inbox is opened, and opening it marks nothing read.
 *
 * @module components/features/notifications/InboxButton
 */
import { Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import { Inbox } from "lucide-react";
import type { JSX } from "react";
import { useState } from "react";

import { cn } from "@admin/lib/utils";

import { InboxPopover } from "./InboxPopover";
import { useUnreadNoticeCount } from "./useNotices";

export interface InboxButtonProps {
  className?: string;
  /** Where the popover opens from the button: to the right of the rail. */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export function InboxButton({
  className,
  side = "bottom",
  align = "end",
}: InboxButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const unread = useUnreadNoticeCount().data ?? 0;
  // What the badge draws, and what the button's name says: a person using
  // speech input says the drawn count to press it, so the name holds it,
  // outside parentheses, which Label in Name sets aside.
  const shownUnread = unread > 9 ? "9+" : String(unread);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Inbox, ${shownUnread} unread` : "Inbox"}
          title="Inbox"
          data-testid="inbox-button"
          className={cn(
            "relative flex items-center justify-center h-11 w-11 rounded-md transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover-subtle-row group",
            className
          )}
        >
          {/* Muted foreground so the resting icon meets contrast; a faint primary alpha did not. */}
          <Inbox
            aria-hidden="true"
            className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors"
          />
          {/* The count is text, so the badge draws the danger status's text and surface colours swapped: the pair the contrast suite already holds to 4.5:1 in both modes. White on the solid red would be 3.84:1. */}
          {unread > 0 && (
            <span
              data-testid="inbox-badge"
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-sm bg-danger-text text-danger-surface text-danger-surface! text-xs font-bold leading-[18px] text-center"
            >
              {shownUnread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        className="p-0 w-auto"
      >
        <InboxPopover onFollowLink={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
