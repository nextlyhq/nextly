"use client";

/**
 * The Inbox's popover: headed "Inbox", with "Mark all read" for the tab shown,
 * two tabs, "For you" and "Alerts", each with its unread count, and each tab's
 * newest items.
 *
 * It opens on Alerts while Alerts has unread items, and on For you otherwise,
 * since an unread alert is the likelier reason the count rose. The tab is
 * chosen once per opening, so marking items read while it is open never moves
 * the person to the other tab. Showing items marks none of them read.
 *
 * @module components/features/notifications/InboxPopover
 */
import { Button } from "@nextlyhq/ui";
import { Content, List, Root, Trigger } from "@radix-ui/react-tabs";
import type { JSX } from "react";
import { useState } from "react";

import { cn } from "@admin/lib/utils";

import { InboxRow } from "./InboxRow";
import type { InboxTab } from "./notices-api";
import {
  useMarkNoticesRead,
  useNoticeList,
  useTabUnreadCount,
} from "./useNotices";

/** Each tab's name, and what it says while it holds nothing. */
const TABS: ReadonlyArray<{ tab: InboxTab; label: string; empty: string }> = [
  { tab: "for-you", label: "For you", empty: "Nothing for you right now." },
  {
    tab: "alerts",
    label: "Alerts",
    empty: "No alerts. Everything on the site is working.",
  },
];

/**
 * The tab the Inbox opens on: Alerts while it has unread items, For you
 * otherwise; `null` until this opening's Alerts count is in, so a count kept
 * from an earlier opening never decides it. An Alerts count that could not be
 * read opens For you, which holds the person's own items.
 */
function openingTab(alerts: {
  isPending: boolean;
  isFetching: boolean;
  data?: number;
}): InboxTab | null {
  if (alerts.isPending || alerts.isFetching) return null;
  return (alerts.data ?? 0) > 0 ? "alerts" : "for-you";
}

function isInboxTab(value: string): value is InboxTab {
  return TABS.some(entry => entry.tab === value);
}

export function InboxPopover({
  headingId,
  onFollowLink,
}: {
  /** The id of the "Inbox" heading, which names the popover. */
  headingId: string;
  /** Called as an item's link is followed, so the popover can close. */
  onFollowLink: () => void;
}): JSX.Element {
  const counts: Record<InboxTab, ReturnType<typeof useTabUnreadCount>> = {
    "for-you": useTabUnreadCount("for-you", true),
    alerts: useTabUnreadCount("alerts", true),
  };
  const markRead = useMarkNoticesRead();
  const [chosen, setChosen] = useState<InboxTab | null>(null);
  // Decided once, the first time the Alerts count is in, and kept: a count
  // that falls as items are read must not move the person off the tab.
  const opening = openingTab(counts.alerts);
  if (chosen === null && opening !== null) setChosen(opening);
  const shown = chosen ?? opening;
  const shownUnread = shown === null ? 0 : (counts[shown].data ?? 0);
  // Unavailable rather than disabled, so a keyboard user who has just marked
  // everything read keeps focus here instead of losing it to the page.
  const nothingToMark =
    shown === null || shownUnread === 0 || markRead.isPending;

  return (
    <div className="flex max-h-[480px] w-96 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
        <h2 id={headingId} className="text-sm font-semibold">
          Inbox
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // "Mark all read" marks the tab shown, every unread item in it,
          // including those not loaded here.
          aria-disabled={nothingToMark}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => {
            if (!nothingToMark && shown !== null) {
              markRead.mutate({ all: true, tab: shown });
            }
          }}
        >
          Mark all read
        </Button>
      </div>
      {shown === null ? (
        <p role="status" className="px-4 pb-3 text-sm text-muted-foreground">
          Loading…
        </p>
      ) : (
        <Root
          value={shown}
          onValueChange={value => {
            if (isInboxTab(value)) setChosen(value);
          }}
          className="flex min-h-0 flex-col"
        >
          <List
            aria-label="Inbox"
            className="flex gap-1 border-b border-border px-3 pb-2"
          >
            {TABS.map(({ tab, label }) => (
              <Trigger
                key={tab}
                value={tab}
                className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=active]:bg-muted data-[state=active]:text-foreground"
              >
                {label} <TabCount tab={tab} count={counts[tab].data ?? 0} />
              </Trigger>
            ))}
          </List>
          {TABS.map(({ tab, empty }) => (
            <Content
              key={tab}
              value={tab}
              className="min-h-0 overflow-y-auto focus-visible:outline-none"
            >
              <InboxTabBody
                tab={tab}
                empty={empty}
                onFollowLink={onFollowLink}
              />
            </Content>
          ))}
        </Root>
      )}
    </div>
  );
}

/**
 * A tab's unread count, drawn beside its name and part of it, so the tab is
 * named, say, "Alerts 1 unread". Alerts draws its count in the danger status's
 * colors, as the Inbox button's own count is drawn.
 */
function TabCount({
  tab,
  count,
}: {
  tab: InboxTab;
  count: number;
}): JSX.Element | null {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "min-w-[18px] rounded-full px-1.5 text-center text-[11px] font-semibold leading-[18px]",
        tab === "alerts"
          ? "bg-danger-text text-danger-surface text-danger-surface!"
          : "bg-background text-foreground"
      )}
    >
      {count > 99 ? "99+" : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

/** A tab's items, or why there are none to show. */
function InboxTabBody({
  tab,
  empty,
  onFollowLink,
}: {
  tab: InboxTab;
  empty: string;
  onFollowLink: () => void;
}): JSX.Element {
  const list = useNoticeList(tab, true);
  if (list.isError) {
    return (
      <p role="alert" className="px-4 py-3 text-sm text-destructive">
        Your Inbox could not be loaded.
      </p>
    );
  }
  if (list.isPending) {
    return (
      <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (list.data.items.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul aria-label={TABS.find(entry => entry.tab === tab)?.label}>
      {list.data.items.map(notice => (
        <li key={notice.id}>
          <InboxRow notice={notice} onFollowLink={onFollowLink} />
        </li>
      ))}
    </ul>
  );
}
