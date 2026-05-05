"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@revnixhq/ui";
import React from "react";

import * as Icons from "@admin/components/icons";
import { Bookmark, Globe, type LucideIcon } from "@admin/components/icons";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@admin/components/layout/sidebar";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useSingles } from "@admin/hooks/queries/useSingles";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useSidebarPins } from "@admin/hooks/useSidebarPins";
import { filterSingleItems } from "@admin/lib/permissions/authorization";
import { cn } from "@admin/lib/utils";

interface DynamicSingleNavProps {
  isActive: (href?: string) => boolean;
  /** Search query to filter singles */
  search?: string;
}

const iconMap = Icons as unknown as Record<string, LucideIcon>;
const PINNED_SINGLES_STORAGE_KEY = "nextly:sidebar:pinned-singles";

/**
 * DynamicSingleNav Component
 *
 * Renders each Single entity directly in the sidebar for easy access.
 * Each item links directly to its content editing page.
 */
export function DynamicSingleNav({
  isActive,
  search = "",
}: DynamicSingleNavProps) {
  const { data: singlesData, isLoading } = useSingles();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { capabilities } = useCurrentUserPermissions();
  const {
    pinned: pinnedSingles,
    isPinned,
    togglePin,
  } = useSidebarPins({
    storageKey: PINNED_SINGLES_STORAGE_KEY,
  });

  // Capitalize first letter of a string for sidebar labels.
  const capitalizeFirstLetter = (str: string) => {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const getDisplayName = (single: { label?: string; slug: string }) => {
    const baseLabel = single.label || single.slug;
    return capitalizeFirstLetter(baseLabel);
  };

  // Filter to singles belonging to the "Singles" sidebar group
  const visibleSingles = (singlesData?.items ?? []).filter(single => {
    if (single.admin?.hidden) return false;

    // Filter by search query if provided
    if (search) {
      const displayName = getDisplayName(single).toLowerCase();
      if (!displayName.includes(search.toLowerCase())) return false;
    }

    const group = single.admin?.sidebarGroup;
    // Explicitly assigned to "singles" group
    if (group === "singles") return true;
    // Default singles: no group assigned
    if (!group) return true;
    return false;
  });

  // Filter by user permissions (only show singles the user can read)
  const permittedSingles = filterSingleItems(visibleSingles, capabilities);

  // Sort by admin.order (ascending, default 100), then alphabetically by label
  const singles = [...permittedSingles].sort((a, b) => {
    const aPinned = pinnedSingles.has(a.slug);
    const bPinned = pinnedSingles.has(b.slug);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;

    const orderA = a.admin?.order ?? 100;
    const orderB = b.admin?.order ?? 100;
    if (orderA !== orderB) return orderA - orderB;
    return getDisplayName(a).localeCompare(getDisplayName(b));
  });

  if (isLoading) return null;

  if (singles.length === 0) {
    return null;
  }

  return (
    <>
      {singles.map(single => {
        const href = buildRoute(ROUTES.SINGLE_EDIT, { slug: single.slug });
        const isItemActive = isActive(href);
        const singlePinned = isPinned(single.slug);
        const displayName = getDisplayName(single);

        return (
          <SidebarMenuItem key={single.slug}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarMenuButton
                  asChild
                  isActive={isItemActive}
                  className={cn(!isCollapsed && "justify-start")}
                >
                  <Link href={href}>
                    {React.createElement(
                      iconMap[single.admin?.icon || ""] || Globe,
                      {
                        className: cn("h-4 w-4 shrink-0"),
                      }
                    )}
                    {!isCollapsed && <span>{displayName}</span>}
                  </Link>
                </SidebarMenuButton>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                hidden={!isCollapsed}
                className="bg-black text-white"
                style={{ backgroundColor: "black", color: "white" }}
              >
                {displayName}
              </TooltipContent>
            </Tooltip>
            {!isCollapsed && (
              <SidebarMenuAction
                showOnHover={!singlePinned}
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePin(single.slug);
                  e.currentTarget.blur();
                }}
                aria-label={singlePinned ? "Unpin single" : "Pin single"}
                aria-pressed={singlePinned}
                title={singlePinned ? "Unpin single" : "Pin single"}
                className={singlePinned ? "opacity-100 text-primary" : ""}
              >
                <Bookmark
                  className={
                    singlePinned
                      ? "h-4 w-4 fill-current cursor-pointer"
                      : "cursor-pointer"
                  }
                />
              </SidebarMenuAction>
            )}
          </SidebarMenuItem>
        );
      })}
    </>
  );
}
