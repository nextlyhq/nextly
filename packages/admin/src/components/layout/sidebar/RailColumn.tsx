"use client";

/**
 * The icon rail's column: its surface, the logo at its head, the scrolling
 * list of entries and the account foot. One component for the rail the reader
 * uses and for the rail drawn while the session is still being checked, so
 * the two are the same column and the entries land where its outline stood.
 *
 * @module components/layout/sidebar/RailColumn
 */

import { Skeleton } from "@nextlyhq/ui";
import type { JSX, ReactNode } from "react";

import { ThemeAwareLogo } from "@admin/components/shared/ThemeAwareLogo";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { cn } from "@admin/lib/utils";

import { shellAnswersMarker } from "../lib/shell-answers";

/**
 * Where keyboard focus is on the rail: a ring, drawn on `:focus-visible`
 * alone, so a pointer click draws none. Offset onto the rail's own surface,
 * so it stays clear of a selected entry's fill and reads in both themes.
 *
 * The browser's outline is hidden only where the ring takes its place, and
 * by `outline-hidden` rather than `outline-none`: under forced colors, as in
 * Windows High Contrast, a box shadow is not drawn, and `outline-hidden`
 * draws a 2px outline there in the system's colour, where `outline-none`
 * would leave focus with nothing drawn at all.
 */
export const RAIL_FOCUS_RING =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

export function RailColumn({
  settled,
  children,
  foot,
}: {
  /** Whether every answer the rail draws from is in. */
  settled: boolean;
  /** The rail's entries. */
  children: ReactNode;
  /** The rail's foot: the reader's Inbox and account menu. */
  foot: ReactNode;
}): JSX.Element {
  const branding = useBranding();
  return (
    <aside
      className={cn(
        // `min-h-0`, so on a short window the rail is as tall as the window
        // and its navigation scrolls, rather than the rail growing past the
        // window and pushing its foot out of sight.
        "flex min-h-0 flex-col items-center py-4 bg-sidebar  border-r border-border z-50",
        "w-[72px] shrink-0"
      )}
      // Whether every answer the rail draws from is in, so a reader of the
      // page (the layout-shift browser test) can tell when the rail is done.
      data-shell-answers={shellAnswersMarker(settled)}
    >
      {/* Logo */}
      <Link
        href={ROUTES.DASHBOARD}
        className={cn(
          "mb-8 flex shrink-0 items-center justify-center h-10 w-10 rounded-md group",
          RAIL_FOCUS_RING
        )}
      >
        <ThemeAwareLogo
          boxed
          className="w-8 h-8 object-contain"
          alt={branding.logoText ?? "Logo"}
        />
      </Link>

      {/* Main Icons */}
      {/* The one part of the rail that gives way on a short window: it
          scrolls, so the logo above and the account foot below stay in
          view. Padded vertically so a focus ring at either end is not cut
          off by the scroll edge. */}
      <nav className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-3 py-1 [scrollbar-width:none]">
        {children}
      </nav>

      {foot}
    </aside>
  );
}

/**
 * Neutral shapes in the place of rail entries not decided yet: an entry's box
 * with a still square where its icon goes. They name nothing, since what the
 * entries are is exactly what is not known.
 *
 * Each shape is keyed by its place in the rail (`from` is the place of the
 * first), so an entry decided at a place replaces the shape there and the
 * shapes after it stay put, rather than every shape sliding down one.
 */
export function RailGhostItems({
  count,
  from = 0,
}: {
  count: number;
  /** The rail place of the first shape: the number of entries drawn above. */
  from?: number;
}): JSX.Element {
  return (
    <>
      {Array.from({ length: Math.max(0, count) }, (_, index) => (
        <span
          key={from + index}
          aria-hidden="true"
          data-testid="rail-ghost-item"
          className="flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <Skeleton still className="size-5 rounded-md" />
        </span>
      ))}
    </>
  );
}

/** The rail's foot before the reader is known: the Inbox's and the avatar's shapes. */
export function RailFootGhost({
  className,
}: {
  className?: string;
}): JSX.Element {
  return (
    <div
      aria-hidden="true"
      data-testid="rail-foot-ghost"
      className={cn("flex flex-col items-center gap-2", className)}
    >
      <span className="flex h-11 w-11 items-center justify-center">
        <Skeleton still className="size-5 rounded-md" />
      </span>
      <Skeleton still className="size-11 rounded-full" />
    </div>
  );
}

/** The widths of the panel's outline rows' names, in order. */
const PANEL_ROW_WIDTHS = [96, 120, 70, 104, 88, 112, 76, 100] as const;

/**
 * Neutral rows in the place of a panel's links not known yet: an icon's
 * square and a name's bar, at a link's height. `as="li"` inside a menu list.
 */
export function PanelGhostRows({
  as: Row = "div",
}: {
  as?: "div" | "li";
}): JSX.Element {
  return (
    <>
      {PANEL_ROW_WIDTHS.map(width => (
        <Row
          key={width}
          aria-hidden="true"
          data-testid="panel-ghost-row"
          className="flex h-8 items-center gap-2 p-2"
        >
          <Skeleton still className="size-4 shrink-0 rounded-sm" />
          <Skeleton still className="h-3 max-w-full" style={{ width }} />
        </Row>
      ))}
    </>
  );
}

/**
 * A panel's body before the session is confirmed: where its Collections and
 * Singles switch, its search and its links will be, at the Content panel's own
 * padding and spacing.
 */
export function PanelGhostBody(): JSX.Element {
  return (
    <div aria-hidden="true" className="space-y-4 px-4 py-6">
      <Skeleton still className="mx-2 h-10 rounded-md" />
      <div className="px-2 pb-2">
        <Skeleton still className="h-9 w-full" />
      </div>
      <div className="flex flex-col gap-1">
        <PanelGhostRows />
      </div>
    </div>
  );
}
