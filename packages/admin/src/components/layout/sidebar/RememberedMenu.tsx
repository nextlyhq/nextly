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
import { Database, Globe } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import type {
  RememberedContentItem,
  RememberedMenu,
} from "@admin/lib/device-memory/device-memory";

import { ContentTypeControl } from "./ContentPanel";
import type { ContentSection } from "./lib/content-rail";
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

/** Whether the remembered menu has anything to list for `part`. */
export function remembersContent(
  menu: RememberedMenu | undefined,
  part: string
): part is ContentSection {
  return (
    (part === "collections" && (menu?.collections.length ?? 0) > 0) ||
    (part === "singles" && (menu?.singles.length ?? 0) > 0)
  );
}

/**
 * The Content panel as this device remembered it: the switch between
 * Collections and Singles where it offered both, the search (inert until the
 * server answers, when the real panel takes its place) and the part's links.
 */
export function RememberedContentBody({
  menu,
  part,
  pathname,
}: {
  menu: RememberedMenu;
  part: ContentSection;
  pathname: string;
}): JSX.Element {
  const items = part === "collections" ? menu.collections : menu.singles;
  // The switch where the panel offered both parts, as the real panel does.
  const both = menu.parts.collections && menu.parts.singles;
  return (
    <div className="space-y-4 px-4 py-6" data-testid="remembered-content">
      {both ? <ContentTypeControl shown={part} dotOn={null} /> : null}
      <SidebarSearch
        placeholder={`Search ${part === "collections" ? "collections" : "Singles"}`}
        value=""
        onChange={() => {}}
        disabled
      />
      <SidebarMenu>
        {items.map(item => {
          const href = hrefOf(part, item);
          // The same fallbacks the real lists draw: a database for a
          // collection, a globe for a Single.
          const fallback = part === "collections" ? Database : Globe;
          const Icon = (item.icon ? ICONS[item.icon] : undefined) ?? fallback;
          return (
            <SidebarMenuItem key={item.slug}>
              <SidebarMenuButton
                asChild
                tooltip={item.label}
                isActive={pathname === href || pathname.startsWith(`${href}/`)}
              >
                <Link href={href}>
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </div>
  );
}
