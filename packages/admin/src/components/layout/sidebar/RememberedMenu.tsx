"use client";

/**
 * The sidebar drawn from what this device remembered, before the server has
 * answered: the rail's real entries in their real order, and the Content
 * panel's real collections and Singles. The same components draw them as
 * draw the sidebar the reader uses, so the server's answer replaces them in
 * place; until it does, they hold names and links only, never any data.
 *
 * @module components/layout/sidebar/RememberedMenu
 */

import type { ElementType, JSX } from "react";

import * as Icons from "@admin/components/icons";
import { Database } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { contentIcon } from "@admin/lib/content-icons";
import type {
  RememberedContentItem,
  RememberedMenu,
} from "@admin/lib/device-memory/device-memory";
import { cn } from "@admin/lib/utils";

import { ContentFold } from "./ContentFold";
import { groupFoldKey, useContentFolds } from "./lib/content-folds";
import { isContentSection, type ContentSection } from "./lib/content-rail";
import { RailEntry } from "./RailColumn";
import { getFilteredMenuItems } from "./sidebar-types";
import { SidebarSearch } from "./SidebarSearch";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./index";

const ICONS = Icons as unknown as Record<string, ElementType>;

/** The admin's own rail entries, whose icons it draws itself. */
const CORE_RAIL_ICONS = new Map<string, ElementType>(
  getFilteredMenuItems(true).map(item => [item.id, item.icon])
);

/** The icon of a remembered entry: the admin's own, or the one it named. */
function iconOf(id: string, named: string | undefined): ElementType {
  return (
    CORE_RAIL_ICONS.get(id) ?? (named ? ICONS[named] : undefined) ?? Database
  );
}

/** The rail's entries as this device remembered them. */
export function RememberedRailEntries({
  menu,
  selected,
}: {
  menu: RememberedMenu;
  /** The rail entry the route is under. */
  selected: string;
}): JSX.Element {
  return (
    <>
      {menu.rail.map(entry => (
        <RailEntry
          key={entry.id}
          label={entry.label}
          icon={iconOf(entry.id, entry.icon)}
          href={entry.href}
          selected={entry.id === selected}
          asLink={entry.href !== "#"}
        />
      ))}
    </>
  );
}

/** Where a content item goes. */
function hrefOf(part: ContentSection, item: RememberedContentItem): string {
  return part === "collections"
    ? buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: item.slug })
    : buildRoute(ROUTES.SINGLE_EDIT, { slug: item.slug });
}

/** Whether the remembered menu has anything to list in the Content panel. */
export function remembersContent(
  menu: RememberedMenu | undefined,
  section: string
): menu is RememberedMenu {
  return (
    isContentSection(section) &&
    (menu?.collections.length ?? 0) + (menu?.singles.length ?? 0) > 0
  );
}

/** Remembered collections listed under one sub-heading, or under none. */
interface RememberedRun {
  group: RememberedContentItem["group"];
  items: RememberedContentItem[];
}

/**
 * The remembered items in runs under one sub-heading each, in their order:
 * the panel kept each group together, then the ungrouped ones.
 */
function runsOf(items: readonly RememberedContentItem[]): RememberedRun[] {
  const runs: RememberedRun[] = [];
  for (const item of items) {
    const last = runs.at(-1);
    if (last !== undefined && last.group?.slug === item.group?.slug) {
      last.items.push(item);
    } else {
      runs.push({ group: item.group, items: [item] });
    }
  }
  return runs;
}

/** One kind's remembered links, as the real lists draw them. */
function RememberedLinks({
  part,
  items,
  pathname,
}: {
  part: ContentSection;
  items: readonly RememberedContentItem[];
  pathname: string;
}): JSX.Element {
  return (
    <SidebarMenu>
      {items.map(item => {
        const href = hrefOf(part, item);
        const active = pathname === href || pathname.startsWith(`${href}/`);
        // The same icons the real lists draw, defaults included.
        const Icon = contentIcon(
          part === "collections" ? "collection" : "single",
          item.icon
        );
        return (
          <SidebarMenuItem key={item.slug}>
            <SidebarMenuButton asChild tooltip={item.label} isActive={active}>
              <Link href={href}>
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "h-4 w-4 shrink-0",
                    !active && "text-muted-foreground"
                  )}
                />
                <span className="min-w-0 truncate">{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/**
 * The Content panel as this device remembered it: the search (inert until the
 * server answers, when the real panel takes its place) and each heading the
 * panel showed with its links, folded as the person left them.
 */
export function RememberedContentBody({
  menu,
  pathname,
}: {
  menu: RememberedMenu;
  pathname: string;
}): JSX.Element {
  const folds = useContentFolds();
  return (
    <div className="space-y-4 px-4 py-6" data-testid="remembered-content">
      <SidebarSearch
        placeholder="Search content"
        label="Search content"
        value=""
        onChange={() => {}}
        disabled
      />
      <nav aria-label="Content" className="space-y-4">
        {menu.parts.collections && menu.collections.length > 0 ? (
          <ContentFold
            foldKey="collections"
            label="Collections"
            count={menu.collections.length}
            level="heading"
            folds={folds}
          >
            {runsOf(menu.collections).map(run =>
              run.group === undefined ? (
                <RememberedLinks
                  key=""
                  part="collections"
                  items={run.items}
                  pathname={pathname}
                />
              ) : (
                <ContentFold
                  key={run.group.slug}
                  foldKey={groupFoldKey(run.group.slug)}
                  label={run.group.label}
                  level="group"
                  folds={folds}
                >
                  <RememberedLinks
                    part="collections"
                    items={run.items}
                    pathname={pathname}
                  />
                </ContentFold>
              )
            )}
          </ContentFold>
        ) : null}
        {menu.parts.singles && menu.singles.length > 0 ? (
          <ContentFold
            foldKey="singles"
            label="Singles"
            count={menu.singles.length}
            level="heading"
            folds={folds}
          >
            <RememberedLinks
              part="singles"
              items={menu.singles}
              pathname={pathname}
            />
          </ContentFold>
        ) : null}
      </nav>
    </div>
  );
}
