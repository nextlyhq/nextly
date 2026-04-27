"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@revnixhq/ui";
import React, { useMemo } from "react";

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
import { useBranding } from "@admin/context/providers/BrandingProvider";
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
const BUILTIN_GROUPS = ["collections", "singles"];

/**
 * Empty state when no singles exist
 */
function EmptySingles({ hasSearch }: { hasSearch?: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton disabled className="opacity-60">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground text-sm">
          {hasSearch ? "No matching singles" : "No singles"}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * DynamicSingleNav Component
 *
 * Renders each Single (Global) entity directly in the sidebar for easy access.
 * Each item links directly to its content editing page.
 */
export function DynamicSingleNav({
  isActive,
  search = "",
}: DynamicSingleNavProps) {
  const { data: singlesData, isLoading } = useSingles();
  const branding = useBranding();
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
  const visibleSingles = (singlesData?.data ?? []).filter(single => {
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

  // Sort by pinning first, then admin.order (ascending, default 100), then alphabetically by label
  const singles = useMemo(() => {
    return [...permittedSingles].sort((a, b) => {
      const aPinned = pinnedSingles.has(a.slug);
      const bPinned = pinnedSingles.has(b.slug);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;

      const orderA = a.admin?.order ?? 100;
      const orderB = b.admin?.order ?? 100;
      if (orderA !== orderB) return orderA - orderB;
      return getDisplayName(a).localeCompare(getDisplayName(b));
    });
  }, [permittedSingles, pinnedSingles]);

  const groupedSingles = useMemo(() => {
    const allSingles = singlesData?.data ?? [];
    const lowerSearch = search.toLowerCase();
    const groupOverrides = new Map<string, string>();

    for (const group of branding?.customGroups ?? []) {
      groupOverrides.set(group.slug, group.name);
    }

    const permitted = filterSingleItems(allSingles, capabilities);
    const discoveredSlugs = new Set<string>();

    for (const single of permitted) {
      const slug = single.admin?.sidebarGroup;
      if (slug && !BUILTIN_GROUPS.includes(slug)) {
        discoveredSlugs.add(slug);
      }
    }

    return Array.from(discoveredSlugs)
      .map(slug => {
        const name =
          groupOverrides.get(slug) ??
          slug.charAt(0).toUpperCase() + slug.slice(1);

        const items = permitted
          .filter(single => {
            if (single.admin?.hidden) return false;
            if (single.admin?.sidebarGroup !== slug) return false;
            if (!search) return true;
            return getDisplayName(single).toLowerCase().includes(lowerSearch);
          })
          .sort((a, b) => {
            const aPinned = pinnedSingles.has(a.slug);
            const bPinned = pinnedSingles.has(b.slug);
            if (aPinned !== bPinned) return aPinned ? -1 : 1;

            const orderA = a.admin?.order ?? 100;
            const orderB = b.admin?.order ?? 100;
            if (orderA !== orderB) return orderA - orderB;
            return getDisplayName(a).localeCompare(getDisplayName(b));
          });

        const order =
          items.length > 0
            ? Math.min(...items.map(single => single.admin?.order ?? 100))
            : 100;

        return { slug, name, items, order };
      })
      .filter(group => group.items.length > 0)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.name.localeCompare(b.name);
      });
  }, [
    singlesData,
    capabilities,
    search,
    branding?.customGroups,
    pinnedSingles,
  ]);

  if (isLoading) return null;

  if (singles.length === 0 && groupedSingles.length === 0) {
    if (isCollapsed) return null;
    return <EmptySingles hasSearch={Boolean(search)} />;
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
      {groupedSingles.map(group => (
        <React.Fragment key={group.slug}>
          {!isCollapsed && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 px-4 mt-3 mb-1 block">
              {group.name}
            </span>
          )}
          {group.items.map(single => {
            const href = buildRoute(ROUTES.SINGLE_EDIT, { slug: single.slug });
            const isItemActive = isActive(href);
            const singlePinned = isPinned(single.slug);
            const displayName = getDisplayName(single);

            return (
              <SidebarMenuItem key={`custom-${single.slug}`}>
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
        </React.Fragment>
      ))}
    </>
  );
}
