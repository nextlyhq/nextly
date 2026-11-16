"use client";

/**
 * The bell's "For you" section: the signed-in person's own notices, newest
 * first, each linked to what it is about where that still exists. The unread
 * ones it shows are marked read once they have been shown, and "Mark all
 * read" marks every unread one, shown or not.
 *
 * @module components/features/notifications/ForYouSection
 */
import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";
import { useEffect, useRef } from "react";

import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";

import type { Notice } from "./notices-api";
import { formatRelativeTime } from "./relative-time";
import { useMarkNoticesRead, useNoticeList } from "./useNotices";

export function ForYouSection(): JSX.Element {
  const notices = useNoticeList(true);
  const markRead = useMarkNoticesRead();
  const items = notices.data?.items ?? [];
  // Shown once is read: the unread ones on screen are marked read once, when
  // they first arrive, so the badge clears without marking what was never seen.
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || notices.data === undefined) return;
    marked.current = true;
    const unread = notices.data.items
      .filter(notice => notice.readAt === null)
      .map(notice => notice.id);
    if (unread.length > 0) markRead.mutate({ ids: unread });
  }, [notices.data, markRead]);

  return (
    <section
      aria-labelledby="notices-for-you"
      className="border-b border-border"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h3 id="notices-for-you" className="text-sm font-semibold">
          For you
        </h3>
        {items.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={markRead.isPending}
            onClick={() => markRead.mutate({ all: true })}
          >
            Mark all read
          </Button>
        ) : null}
      </div>
      <ForYouBody
        items={items}
        isPending={notices.isPending}
        isError={notices.isError}
      />
    </section>
  );
}

/** The notices, or why there are none to show. */
function ForYouBody({
  items,
  isPending,
  isError,
}: {
  items: Notice[];
  isPending: boolean;
  isError: boolean;
}) {
  if (isError) {
    return (
      <p role="alert" className="px-4 pb-3 text-sm text-destructive">
        Your notices could not be loaded.
      </p>
    );
  }
  if (isPending) {
    return (
      <p role="status" className="px-4 pb-3 text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="px-4 pb-3 text-sm text-muted-foreground">
        Nothing for you yet.
      </p>
    );
  }
  return (
    <ul aria-label="Your notices" className="flex flex-col pb-2">
      {items.map(notice => (
        <li key={notice.id}>
          <NoticeRow notice={notice} />
        </li>
      ))}
    </ul>
  );
}

/** One notice: its title, linked where its subject still has a place, and when. */
function NoticeRow({ notice }: { notice: Notice }) {
  const unread = notice.readAt === null;
  const content = (
    <span className="flex flex-col gap-0.5">
      <span className={cn("text-sm", unread ? "font-semibold" : "font-normal")}>
        {notice.title}
      </span>
      {notice.body ? (
        <span className="text-xs text-muted-foreground">{notice.body}</span>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {formatRelativeTime(notice.createdAt)}
        {unread ? <span className="sr-only"> · unread</span> : null}
      </span>
    </span>
  );
  const link = notice.subject.gone ? null : notice.subject.link;
  return link ? (
    <Link
      href={link}
      className="block px-4 py-2 hover-subtle-row focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {content}
    </Link>
  ) : (
    <div className="px-4 py-2">{content}</div>
  );
}
