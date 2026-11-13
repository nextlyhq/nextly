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

import type { JSX, ReactNode } from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { cn } from "@admin/lib/utils";

import { useSuppressedChrome } from "../ChromeSuppression";

import { isContentSection } from "./lib/content-rail";
import { isSubSidebarCategory, isSubSidebarOpen } from "./lib/has-sub-sidebar";
import {
  subSidebarBorderClass,
  subSidebarHoldsWidth,
} from "./lib/sub-sidebar-classes";
import { PanelGhostBody } from "./RailColumn";
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

const TITLE_CLASS =
  "font-bold text-base tracking-tight capitalize text-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150";

/**
 * The panel's title. The Content panel's goes to the Content overview, the
 * page of every collection and Single the panel lists; the others name it.
 */
function PanelTitle({
  selectedMain,
  standaloneLabel,
}: {
  selectedMain: string;
  standaloneLabel: string;
}): JSX.Element {
  const title = panelTitle(selectedMain, standaloneLabel);
  if (!isContentSection(selectedMain)) {
    return <span className={TITLE_CLASS}>{title}</span>;
  }
  return (
    <Link
      href={ROUTES.CONTENT}
      className={cn(
        TITLE_CLASS,
        "rounded-sm outline-none hover:underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      {title}
    </Link>
  );
}

export function SubSidebarPanel({
  isMobile,
  selectedMain,
  visibleMenuItemIds,
  isFolderTreeVisible,
  standaloneLabel,
  content,
  outlineBody,
}: {
  isMobile: boolean;
  selectedMain: string;
  visibleMenuItemIds: readonly string[];
  isFolderTreeVisible: boolean;
  standaloneLabel: string;
  /**
   * Everything `SubSidebarContent` needs, passed through unread. Absent for
   * the panel's outline, drawn before the session is confirmed: then the panel
   * opens for the route's section alone and holds neutral rows where its
   * links will be.
   */
  content?: React.ComponentProps<typeof SubSidebarContent>;
  /**
   * What the panel's outline holds in place of its neutral rows: the panel
   * drawn from what this device remembered, where it remembered one.
   */
  outlineBody?: ReactNode;
}): JSX.Element {
  const suppressed = useSuppressedChrome();
  const hasSubSidebar = isSubSidebarOpen(
    selectedMain,
    // The outline knows no entries yet, so the route's section stands for
    // the one entry it will open.
    content === undefined ? [selectedMain] : visibleMenuItemIds,
    isFolderTreeVisible,
    suppressed
  );
  const layout = {
    isMobile,
    hasSubSidebar,
    // From the selection alone, which follows the route: the track is held
    // from the first paint on a page whose section has a panel, and absent on
    // one whose section has none.
    sectionHasPanel: isSubSidebarCategory(selectedMain, isFolderTreeVisible),
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
        // layout the track has it on a page whose section owns a panel, from
        // the first paint, and none on a page without one; on the narrow
        // layout the panel overlays inside the drawer and has width only while
        // open.
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
      <div className="h-(--admin-bar-height) shrink-0 px-6 flex items-center border-b border-border">
        {hasSubSidebar ? (
          <PanelTitle
            selectedMain={selectedMain}
            standaloneLabel={standaloneLabel}
          />
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
          {content === undefined ? (
            (outlineBody ?? <PanelGhostBody />)
          ) : (
            <SubSidebarContent {...content} />
          )}
        </div>
      ) : null}
    </aside>
  );
}
