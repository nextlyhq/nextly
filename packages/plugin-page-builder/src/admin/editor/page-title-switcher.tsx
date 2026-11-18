"use client";

/**
 * The page title in the top bar, as a switcher: "+ New page…" first, then
 * the page on screen, the pages edited most recently, and "All pages…",
 * which opens the Pages panel.
 *
 * "+ New page…" opens the New page dialog, the one the Pages panel's "New
 * page" opens, which makes a page only when its button is pressed and asks
 * first about unsaved work on the page on screen. It is offered only where
 * the dialog's own read lists a collection the author may make a page in.
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
import { Check, ChevronDown, FileText } from "lucide-react";
import * as React from "react";

import type { NewPageFacts } from "../../pages-write-contract";
import {
  useNewPageDialog,
  type PageOnScreen,
} from "../new-page/new-page-dialog";
import { useNewPageFacts } from "../new-page/new-page-facts";

import { builderAddress } from "./builder-address";
import {
  readRecentPages,
  recentPagesStore,
  recentToOffer,
  rememberPage,
  type RecentPage,
} from "./recent-pages";

/** The menu's first item, as decided. */
const NEW_PAGE_ITEM = "+ New page…";

export interface PageTitleSwitcherProps {
  /** The page's title as the form holds it now. */
  title: string;
  /** The page being edited, or null where it has no saved identity yet. */
  current: RecentPage | null;
  /** The author's id, whose history this is. */
  userId: string | null;
  /** Whether the page on screen holds work not yet saved. */
  unsavedWork: boolean;
  /** Opens the Pages panel. */
  onAllPages: () => void;
}

export function PageTitleSwitcher({
  title: formTitle,
  current,
  userId,
  unsavedWork,
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

  const title = formTitle.trim() === "" ? "Untitled" : formTitle.trim();
  const menu = (newPage: (() => void) | undefined) => (
    <SwitcherMenu
      title={title}
      current={current}
      store={store}
      newPage={newPage}
      onAllPages={onAllPages}
    />
  );
  // A page not saved yet has no collection to ask about.
  if (collection === undefined) return menu(undefined);
  return (
    <WithNewPage
      collection={collection}
      onScreen={{ unsavedWork, title }}
      menu={menu}
    />
  );
}

/**
 * The New page dialog for the menu, and the way to open it where the author
 * may make a page: in the page's own collection, else the first builder
 * collection the dialog's read lists for them.
 */
function WithNewPage({
  collection,
  onScreen,
  menu,
}: {
  collection: string;
  onScreen: PageOnScreen;
  menu: (newPage: (() => void) | undefined) => React.JSX.Element;
}): React.JSX.Element {
  const { facts } = useNewPageFacts({ collection, title: "" });
  const dialog = useNewPageDialog(onScreen);
  const target = creatableCollection(facts, collection);
  return (
    <>
      {menu(target === undefined ? undefined : () => dialog.open(target))}
      {dialog.dialog}
    </>
  );
}

/** Where a new page goes: this collection if the author may add to it, else the first they may. */
function creatableCollection(
  facts: NewPageFacts | undefined,
  collection: string
): string | undefined {
  if (facts === undefined) return undefined;
  const slugs = facts.collections.map(each => each.slug);
  return slugs.includes(collection) ? collection : slugs[0];
}

function SwitcherMenu({
  title,
  current,
  store,
  newPage,
  onAllPages,
}: {
  title: string;
  current: RecentPage | null;
  store: ReturnType<typeof recentPagesStore>;
  newPage: (() => void) | undefined;
  onAllPages: () => void;
}): React.JSX.Element {
  // Read when the menu opens, not at mount, so another tab's history counts.
  const [recent, setRecent] = React.useState<RecentPage[]>([]);
  const trigger = React.useRef<HTMLButtonElement>(null);
  // The dialog opens once the menu has CLOSED, from the title: opened while
  // it closes, the menu's focus return would pull focus out of the dialog.
  const newPageAfterClose = React.useRef(false);

  return (
    <DropdownMenu
      onOpenChange={open => {
        if (open) setRecent(recentToOffer(readRecentPages(store), current));
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          ref={trigger}
          type="button"
          // At the editor's control height, as the rest of the top bar.
          className="inline-flex h-[var(--nx-builder-control-height)] min-w-0 max-w-[16rem] items-center gap-1 rounded-md px-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${title}: switch page`}
        >
          <span className="truncate">{title}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[16rem]"
        onCloseAutoFocus={event => {
          if (!newPageAfterClose.current || newPage === undefined) return;
          newPageAfterClose.current = false;
          event.preventDefault();
          // The dialog gives focus back to what had it when it opened.
          trigger.current?.focus();
          newPage();
        }}
      >
        {newPage === undefined ? null : (
          <>
            <DropdownMenuItem
              className="font-medium text-primary"
              onSelect={() => {
                newPageAfterClose.current = true;
              }}
            >
              {NEW_PAGE_ITEM}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {current === null ? null : (
          // The page on screen, where choosing it stays.
          <DropdownMenuItem aria-current="page">
            <Check aria-hidden="true" className="size-4" />
            <span className="truncate">{title}</span>
          </DropdownMenuItem>
        )}
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
          </>
        )}
        {current === null && recent.length === 0 ? null : (
          <DropdownMenuSeparator />
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
