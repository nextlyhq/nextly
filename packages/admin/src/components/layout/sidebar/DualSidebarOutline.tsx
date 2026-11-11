"use client";

/**
 * The sidebar while the session is still being checked: the rail with its
 * logo, neutral shapes where its entries and its account foot will be, and the
 * route's panel, open with neutral rows where it will open. Nothing in it
 * reads the reader's data, which no screen may show before the server has
 * confirmed who they are; the real sidebar replaces it in the same places.
 *
 * @module components/layout/sidebar/DualSidebarOutline
 */

import type { JSX } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useMediaContext } from "@admin/context/providers/MediaProvider";
import { useRoutedPathname } from "@admin/context/RoutedPathnameContext";

import { sectionShown } from "./lib/content-rail";
import { resolveActiveSection } from "./lib/resolve-section";
import { RailColumn, RailFootGhost, RailGhostItems } from "./RailColumn";
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

  return (
    <div className="flex h-full overflow-hidden">
      <RailColumn
        settled={false}
        foot={<RailFootGhost className="mt-4 shrink-0" />}
      >
        {/* As many shapes as the rail has entries before any is ruled out. */}
        <RailGhostItems count={getFilteredMenuItems(showBuilder).length} />
      </RailColumn>
      <SubSidebarPanel
        isMobile={isMobile}
        selectedMain={shown}
        visibleMenuItemIds={[]}
        isFolderTreeVisible={isFolderTreeVisible}
        standaloneLabel=""
      />
    </div>
  );
}
