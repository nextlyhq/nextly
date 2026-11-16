"use client";

/**
 * F10 PR 5 — bell icon + popover trigger for the notification dropdown.
 *
 * Hidden entirely when the caller is not a super-admin (the journal
 * endpoint is super-admin-only; non-supers would see a 403 anyway).
 *
 * Badge math comes from `useUnreadCount` (localStorage `lastSeen` +
 * `visibilitychange` refresh). Opening the popover marks all visible
 * rows as seen, resetting the badge to 0.
 *
 * @module components/features/notifications/NotificationBell
 */

import { Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import { Bell } from "lucide-react";
import type { JSX } from "react";
import { useState } from "react";

import { JOURNAL_PAGE_SIZE, useJournal } from "@admin/hooks/queries/useJournal";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { cn } from "@admin/lib/utils";

import { ForYouSection } from "./ForYouSection";
import { NotificationDropdown } from "./NotificationDropdown";
import { useUnreadNoticeCount } from "./useNotices";
import { useUnreadCount } from "./useUnreadCount";

export interface NotificationBellProps {
  className?: string;
  /**
   * Whether this workspace has a schema-change journal to show: where the
   * builder runs. Every reader's own notices are shown either way; the
   * journal, a super-admin's alone, only where it is offered.
   */
  journalOffered?: boolean;
  /** Where the list opens from the bell: to the right of the rail. */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export function NotificationBell({
  className,
  journalOffered = true,
  side = "bottom",
  align = "end",
}: NotificationBellProps): JSX.Element | null {
  const { isSuperAdmin, isLoading: permissionsLoading } =
    useCurrentUserPermissions();
  const [open, setOpen] = useState(false);

  // The journal is a super-admin's, and only where the workspace has one: it is
  // never read for anyone else, whose read would be refused. Where it is shown
  // it is read with the popover closed too, since the badge counts its unread
  // rows; once, via React Query's stale time.
  const showJournal = !permissionsLoading && isSuperAdmin && journalOffered;
  const { data } = useJournal(
    { limit: JOURNAL_PAGE_SIZE },
    { enabled: showJournal }
  );
  const rows = data?.rows ?? [];
  const { unread: journalUnread, markAllSeen } = useUnreadCount(rows);
  // Every admin user has notices of their own; the schema-change journal stays
  // a super-admin's, so its unread rows count only for one.
  const noticeUnread = useUnreadNoticeCount().data ?? 0;

  if (permissionsLoading) return null;

  const unread = noticeUnread + (showJournal ? journalUnread : 0);
  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next && showJournal) {
      // Open → mark everything currently visible as seen.
      markAllSeen();
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            unread > 0 ? `Notifications (${unread} unread)` : "Notifications"
          }
          data-testid="notification-bell"
          className={cn(
            "relative flex items-center justify-center h-11 w-11 rounded-md transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover-subtle-row group",
            className
          )}
        >
          {/* Muted foreground so the resting bell icon meets contrast; a faint primary alpha did not. */}
          <Bell className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          {/* The count is text, so the badge draws the danger status's text and surface colours swapped: the pair the contrast suite already holds to 4.5:1 in both modes. White on the solid red would be 3.84:1. */}
          {unread > 0 && (
            <span
              data-testid="notification-bell-badge"
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-sm bg-danger-text text-danger-surface text-danger-surface! text-xs font-bold leading-[18px] text-center"
            >
              {unread > 9 ? "9+" : String(unread)}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        className="p-0 w-auto"
        data-testid="notification-bell-popover"
      >
        {/* Your own notices first; the schema changes below, a super-admin's alone. */}
        <div className="w-96 max-h-[480px] overflow-y-auto">
          <ForYouSection />
          {showJournal ? <NotificationDropdown /> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
