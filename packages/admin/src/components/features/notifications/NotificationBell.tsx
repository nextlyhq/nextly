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

import { Bell } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui";
import { JOURNAL_PAGE_SIZE, useJournal } from "@admin/hooks/queries/useJournal";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { cn } from "@admin/lib/utils";

import { NotificationDropdown } from "./NotificationDropdown";
import { useUnreadCount } from "./useUnreadCount";

export interface NotificationBellProps {
  className?: string;
}

export function NotificationBell({ className }: NotificationBellProps) {
  const { isSuperAdmin, isLoading: permissionsLoading } =
    useCurrentUserPermissions();
  const [open, setOpen] = useState(false);

  // The journal query is fetched here even when the popover is closed
  // because the badge needs the row list to compute `unread`. Fetched
  // lazily-once via React Query's stale-time; cheap.
  const { data } = useJournal({ limit: JOURNAL_PAGE_SIZE });
  const rows = data?.rows ?? [];
  const { unread, markAllSeen } = useUnreadCount(rows);

  if (permissionsLoading || !isSuperAdmin) return null;

  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) {
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
            unread > 0
              ? `Recent schema changes (${unread} unread)`
              : "Recent schema changes"
          }
          data-testid="notification-bell"
          className={cn(
            "relative flex items-center justify-center h-9 w-9 rounded-md",
            "text-muted-foreground hover:text-foreground hover:bg-accent",
            "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
            className
          )}
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span
              data-testid="notification-bell-badge"
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold leading-[18px] text-center"
            >
              {unread > 9 ? "9+" : String(unread)}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="p-0 w-auto"
        data-testid="notification-bell-popover"
      >
        <NotificationDropdown />
      </PopoverContent>
    </Popover>
  );
}
