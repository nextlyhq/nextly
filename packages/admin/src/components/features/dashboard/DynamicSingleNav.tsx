"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@nextlyhq/ui";
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
import { getSidebarSinglesForLanding } from "@admin/lib/sidebar-landing";
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

  // Apply the SAME filter + sort that the redirect at /admin/singles uses
  // (see `lib/sidebar-landing.ts`). Centralising the order keeps the
  // sidebar's first item and the redirect's landing target in lock-step.
  // Search filtering still happens here because it's sidebar-only state.
  const baseSingles = getSidebarSinglesForLanding(singlesData?.items ?? [], {
    capabilities,
    pinnedSingles,
  });
  const singles = search
    ? baseSingles.filter(s =>
        getDisplayName(s).toLowerCase().includes(search.toLowerCase())
      )
    : baseSingles;

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
