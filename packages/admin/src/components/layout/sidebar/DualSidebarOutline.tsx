"use client";

/**
 * The sidebar while the session is still being checked: the rail with its
 * logo, its entries and the route's panel as this device remembered them
 * (names and links only), or neutral shapes in their places where it
 * remembers none, and a neutral shape for the account foot. Nothing in it
 * reads data from the server, which no screen may show before the server has
 * confirmed who they are; the real sidebar replaces it in the same places.
 *
 * @module components/layout/sidebar/DualSidebarOutline
 */

import { useState, type JSX } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useMediaContext } from "@admin/context/providers/MediaProvider";
import { useRoutedPathname } from "@admin/context/RoutedPathnameContext";
import { recallMenu } from "@admin/lib/device-memory/device-memory";

import { railItemOf, sectionShown } from "./lib/content-rail";
import { resolveActiveSection } from "./lib/resolve-section";
import { RailAccountOutline } from "./RailAccount";
import { RailColumn, RailGhostItems } from "./RailColumn";
import {
  RememberedContentBody,
  RememberedRailEntries,
  remembersContent,
} from "./RememberedMenu";
import { getFilteredMenuItems } from "./sidebar-types";
import { SubSidebarPanel } from "./SubSidebarPanel";

/** Both content kinds read as available until the lists say otherwise. */
const CONTENT_UNKNOWN = { collections: true, singles: true } as const;

export function DualSidebarOutline({
  isMobile = false,
}: {
  isMobile?: boolean;
}): JSX.Element {
  const pathname = useRoutedPathname() ?? "";
  const branding = useBranding();
  const showBuilder = branding?.showBuilder ?? true;
  const { isFolderTreeVisible } = useMediaContext();
  // The section from the route alone, as the real sidebar's first answer is:
  // with no collections known, a collection's placement is not either.
  const section =
    resolveActiveSection({
      pathname,
      collections: undefined,
      getCollectionPlacement: () => undefined,
      standalonePlugins: [],
      showBuilder,
    }) ?? "dashboard";
  const shown = sectionShown(section, CONTENT_UNKNOWN);
  // The menu as this device last saw it, read once: the server's answer
  // replaces the whole outline, not this.
  const [menu] = useState(recallMenu);

  return (
    <div className="flex h-full overflow-hidden">
      <RailColumn
        settled={false}
        // The foot's own box, as the real foot draws it, so nothing moves
        // when the reader's Inbox and avatar replace these shapes.
        foot={<RailAccountOutline className="mt-4 shrink-0" />}
      >
        {menu === undefined ? (
          // As many shapes as the rail has entries before any is ruled out.
          <RailGhostItems count={getFilteredMenuItems(showBuilder).length} />
        ) : (
          <RememberedRailEntries menu={menu} selected={railItemOf(shown)} />
        )}
      </RailColumn>
      <SubSidebarPanel
        isMobile={isMobile}
        selectedMain={shown}
        visibleMenuItemIds={[]}
        isFolderTreeVisible={isFolderTreeVisible}
        standaloneLabel=""
        outlineBody={
          remembersContent(menu, shown) ? (
            <RememberedContentBody menu={menu} pathname={pathname} />
          ) : undefined
        }
      />
    </div>
  );
}
