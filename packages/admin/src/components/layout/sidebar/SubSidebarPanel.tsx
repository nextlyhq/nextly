"use client";

/**
 * The secondary panel: the detail menu beside the icon rail.
 *
 * Its own component because it owns one question — whether the panel is showing
 * at all — and that question has three inputs: the rail's selection, whether
 * the selection is a category that HAS a panel, and whether a mounted surface
 * has asked for the panel to go. Answering it inside the sidebar meant a
 * 500-line component grew another branch every time one of those changed.
 *
 * The suppression is read here rather than passed in, because this is the
 * component the answer is about: an immersive editor asking for `subSidebar`
 * wants the width back, and the layout above only drops the whole sidebar
 * COLUMN when the primary rail is surrendered too.
 *
 * On the wide layout the panel's track is held at the open panel's width on
 * every surface, panel or not, so the main column keeps one left edge as the
 * reader moves between the dashboard and a collection.
 */

import type { JSX } from "react";

import { cn } from "@admin/lib/utils";

import { useSuppressedChrome } from "../ChromeSuppression";

import { isContentSection } from "./lib/content-rail";
import { isSubSidebarOpen } from "./lib/has-sub-sidebar";
import {
  subSidebarBorderClass,
  subSidebarHoldsWidth,
} from "./lib/sub-sidebar-classes";
import { SubSidebarContent } from "./SubSidebarContent";

/** The panel's own title, which is the selection's name unless it has one. */
function panelTitle(selectedMain: string, standaloneLabel: string): string {
  if (selectedMain.startsWith("standalone-")) return standaloneLabel;
  if (selectedMain === "media") return "Media Library";
  if (selectedMain === "builders") return "Builders";
  // Both content sections show in the one Content panel.
  if (isContentSection(selectedMain)) return "Content";
  return selectedMain;
}

export function SubSidebarPanel({
  isMobile,
  selectedMain,
  visibleMenuItemIds,
  isFolderTreeVisible,
  standaloneLabel,
  content,
}: {
  isMobile: boolean;
  selectedMain: string;
  visibleMenuItemIds: readonly string[];
  isFolderTreeVisible: boolean;
  standaloneLabel: string;
  /** Everything `SubSidebarContent` needs, passed through unread. */
  content: React.ComponentProps<typeof SubSidebarContent>;
}): JSX.Element {
  const suppressed = useSuppressedChrome();
  const hasSubSidebar = isSubSidebarOpen(
    selectedMain,
    visibleMenuItemIds,
    isFolderTreeVisible,
    suppressed
  );
  const layout = {
    isMobile,
    hasSubSidebar,
    released: suppressed.has("subSidebar"),
  };

  return (
    <aside
      data-testid="sub-sidebar"
      // The held track on the wide layout is empty while the selection owns no
      // panel, and an empty landmark is noise to assistive technology.
      aria-hidden={hasSubSidebar ? undefined : true}
      className={cn(
        "flex flex-col bg-background overflow-hidden shrink-0",
        // The width is one decision (`subSidebarHoldsWidth`): on the wide
        // layout the track keeps it whether or not a panel is showing, so the
        // main column beside it never moves; on the narrow layout the panel
        // overlays inside the drawer and has width only while open.
        subSidebarHoldsWidth(layout) ? "w-64" : "w-0",
        subSidebarBorderClass(layout),
        isMobile && "relative",
        isMobile &&
          !hasSubSidebar &&
          "opacity-0 -translate-x-full pointer-events-none"
      )}
    >
      {/*
        The title band stays while the track is empty, so the rule under it
        continues the header's own across the shell instead of stopping at the
        track's edge. What arrives in the track fades in, under motion-safe, so
        it reads as the panel opening in place rather than appearing.
      */}
      <div className="h-16 px-6 flex items-center  border-b border-border">
        {hasSubSidebar ? (
          <span className="font-bold text-base tracking-tight capitalize text-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
            {panelTitle(selectedMain, standaloneLabel)}
          </span>
        ) : null}
      </div>

      {/*
        Not rendered while closed, rather than hidden. Zero width, zero opacity
        and `pointer-events-none` remove a subtree from SIGHT and from the
        mouse, and leave every link in the tab order — so a keyboard user tabs
        through an invisible menu and is navigated out of the editor by a link
        they cannot see. `inert` would express this directly, but it is a
        boolean prop only from React 19 and this package supports 18 as well.
      */}
      {hasSubSidebar ? (
        <div className="flex-1 overflow-y-auto motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
          <SubSidebarContent {...content} />
        </div>
      ) : null}
    </aside>
  );
}
