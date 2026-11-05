"use client";

/**
 * The page title in the top bar, as a switcher: it opens the pages edited
 * most recently and "All pages…", which opens the Pages panel.
 *
 * Opening a page goes through `navigateTo`, so the admin's unsaved-changes
 * guard asks first when the page being left has work not yet saved.
 *
 * @module page-title-switcher
 */

import { navigateTo } from "@nextlyhq/plugin-sdk/admin";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { ChevronDown, FileText } from "lucide-react";
import * as React from "react";

import { builderAddress } from "./builder-address";
import {
  readRecentPages,
  recentPagesStore,
  recentToOffer,
  rememberPage,
  type RecentPage,
} from "./recent-pages";

export interface PageTitleSwitcherProps {
  /** The page's title as the form holds it now. */
  title: string;
  /** The page being edited, or null where it has no saved identity yet. */
  current: RecentPage | null;
  /** The author's id, whose history this is. */
  userId: string | null;
  /** Opens the Pages panel. */
  onAllPages: () => void;
}

export function PageTitleSwitcher({
  title: formTitle,
  current,
  userId,
  onAllPages,
}: PageTitleSwitcherProps): React.JSX.Element {
  const store = React.useMemo(() => recentPagesStore(userId), [userId]);
  // Remembered as opened once per page and title, so a rename shows in the
  // history the next time it is read. Keyed on the page's own values, since
  // the object a host hands in is a new one on every render.
  const collection = current?.collection;
  const id = current?.id;
  const field = current?.field;
  const pageTitle = current?.title;
  React.useEffect(() => {
    if (
      collection === undefined ||
      id === undefined ||
      field === undefined ||
      pageTitle === undefined
    ) {
      return;
    }
    rememberPage(store, { collection, id, field, title: pageTitle });
  }, [store, collection, id, field, pageTitle]);

  // Read when the menu opens, not at mount, so another tab's history counts.
  const [recent, setRecent] = React.useState<RecentPage[]>([]);
  const title = formTitle.trim() === "" ? "Untitled" : formTitle.trim();

  return (
    <DropdownMenu
      onOpenChange={open => {
        if (open) setRecent(recentToOffer(readRecentPages(store), current));
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // At the editor's control height, as the rest of the top bar.
          className="inline-flex h-[var(--nx-builder-control-height)] min-w-0 max-w-[16rem] items-center gap-1 rounded-md px-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${title}: switch page`}
        >
          <span className="truncate">{title}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[16rem]">
        {recent.length === 0 ? null : (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Recent
            </DropdownMenuLabel>
            {recent.map(page => (
              <DropdownMenuItem
                key={`${page.collection}:${page.id}`}
                onSelect={() => openPage(page)}
              >
                <FileText
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
                <span className="truncate">{page.title || "Untitled"}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={onAllPages}>All pages…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Opens a page in the editor, where the admin's guard asks first if needed. */
function openPage(page: RecentPage): void {
  const address = builderAddress(
    { kind: "collection", slug: page.collection, documentId: page.id },
    page.field
  );
  if ("href" in address) navigateTo(address.href);
}
