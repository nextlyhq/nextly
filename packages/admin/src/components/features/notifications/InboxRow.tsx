"use client";

/**
 * One Inbox item: its text, how long ago it happened and the area it came
 * from, marked when unread by a dot and a heavier weight, and named "Unread"
 * to screen readers, so the mark never rests on color alone.
 *
 * Opening it (a click, or Enter) marks it read and follows its link; an item
 * with no link is marked read where it is. Being shown never marks it read.
 * A read item's menu offers "Mark as unread".
 *
 * @module components/features/notifications/InboxRow
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { MoreHorizontal } from "lucide-react";
import type { JSX, ReactNode } from "react";

import { Link } from "@admin/components/ui/link";
import { formatRelativeTime } from "@admin/lib/dashboard";
import { cn } from "@admin/lib/utils";

import { noticeSource } from "./notice-source";
import type { Notice } from "./notices-api";
import { useMarkNoticesRead, useMarkNoticesUnread } from "./useNotices";

/** The row's opening control: the whole row, focusable, one tab stop. */
const OPEN_CLASS =
  "flex min-w-0 flex-1 gap-3 px-4 py-3 text-left hover-subtle-row focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

export function InboxRow({
  notice,
  onFollowLink,
}: {
  notice: Notice;
  /** Called as the item's link is followed, so the Inbox can close. */
  onFollowLink: () => void;
}): JSX.Element {
  const unread = notice.readAt === null;
  const markRead = useMarkNoticesRead();
  const markUnread = useMarkNoticesUnread();
  const link = notice.subject.gone ? null : notice.subject.link;

  // Opening is the one act that reads an item; an item already read is left
  // with the time it was first read.
  const markOpened = (): void => {
    if (unread) markRead.mutate({ ids: [notice.id] });
  };

  const content = <InboxRowContent notice={notice} unread={unread} />;

  return (
    <div className="group flex items-start border-b border-border last:border-b-0">
      {link ? (
        <Link
          href={link}
          className={OPEN_CLASS}
          onClick={() => {
            markOpened();
            onFollowLink();
          }}
          // A middle click opens the item in a new browser tab: it is
          // opened, so it is read, though this Inbox stays open.
          onAuxClick={event => {
            if (event.button === 1) markOpened();
          }}
        >
          {content}
        </Link>
      ) : (
        <button type="button" className={OPEN_CLASS} onClick={markOpened}>
          {content}
        </button>
      )}
      {unread ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More actions for ${notice.title}`}
              className="mr-2 mt-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover-subtle-row hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          {/* Above the Inbox popover it opens from: a menu sits at z-50 and a
              popover at z-[100], so without this it would open underneath
              the rows it belongs to and could not be clicked. */}
          <DropdownMenuContent align="end" className="z-[110]">
            <DropdownMenuItem
              onSelect={() => markUnread.mutate({ ids: [notice.id] })}
            >
              Mark as unread
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** What a row says: the unread mark, the item's text, and when and where from. */
function InboxRowContent({
  notice,
  unread,
}: {
  notice: Notice;
  unread: boolean;
}): ReactNode {
  const source = noticeSource(notice.kind);
  return (
    <>
      {/* The dot is a shape, present or absent, not a color change; the
          heavier title and the spoken "Unread" carry the same mark. */}
      <span
        aria-hidden="true"
        data-testid={unread ? "inbox-unread-dot" : undefined}
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          unread ? "bg-primary" : "bg-transparent"
        )}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "text-sm text-foreground",
            unread ? "font-semibold" : "font-normal"
          )}
        >
          {unread ? <span className="sr-only">Unread: </span> : null}
          {notice.title}
        </span>
        {notice.body ? (
          <span className="text-xs text-muted-foreground">{notice.body}</span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(notice.createdAt)}
          {source ? ` · ${source}` : null}
        </span>
      </span>
    </>
  );
}
