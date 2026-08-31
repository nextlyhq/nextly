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
 */
import { cn } from "@admin/lib/utils";

import { useSuppressedChrome } from "../ChromeSuppression";

import { isSubSidebarOpen } from "./lib/has-sub-sidebar";
import { subSidebarBorderClass } from "./lib/sub-sidebar-classes";
import { SubSidebarContent } from "./SubSidebarContent";

/** The panel's own title, which is the selection's name unless it has one. */
function panelTitle(selectedMain: string, standaloneLabel: string): string {
  if (selectedMain.startsWith("standalone-")) return standaloneLabel;
  if (selectedMain === "media") return "Media Library";
  if (selectedMain === "builders") return "Builders";
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
}) {
  const hasSubSidebar = isSubSidebarOpen(
    selectedMain,
    visibleMenuItemIds,
    isFolderTreeVisible,
    useSuppressedChrome()
  );

  return (
    <aside
      className={cn(
        "flex flex-col bg-background overflow-hidden shrink-0",
        isMobile
          ? "relative flex"
          : "fixed inset-y-0 left-[72px] z-45 lg:static lg:flex", // Absolute on tablet, static on desktop
        subSidebarBorderClass({ isMobile, hasSubSidebar }),
        hasSubSidebar
          ? "w-64 opacity-100 translate-x-0"
          : "w-0 opacity-0 -translate-x-full pointer-events-none lg:w-0 lg:-translate-x-0",
        !isMobile && "lg:translate-x-0 lg:opacity-100" // Reset for desktop
      )}
    >
      <div className="h-16 px-6 flex items-center  border-b border-border">
        <span className="font-bold text-base tracking-tight capitalize text-foreground">
          {panelTitle(selectedMain, standaloneLabel)}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <SubSidebarContent {...content} />
      </div>
    </aside>
  );
}
