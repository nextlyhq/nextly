"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@revnixhq/ui";
import React, { useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { Database, Globe, type LucideIcon } from "@admin/components/icons";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@admin/components/layout/sidebar";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCollections } from "@admin/hooks/queries";
import { useSingles } from "@admin/hooks/queries/useSingles";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import {
  filterCollectionItems,
  filterSingleItems,
} from "@admin/lib/permissions/authorization";
import { cn } from "@admin/lib/utils";

const iconMap = Icons as unknown as Record<string, LucideIcon>;

interface DynamicCustomGroupNavProps {
  /** Function to check if a route is active */
  isActive: (href?: string) => boolean;
  /** Search query to filter items */
  search?: string;
}


interface GroupItem {
  type: "collection" | "single";
  key: string;
  label: string;
  href: string;
  icon: string;
  order: number;
}

/**
 * DynamicCustomGroupNav Component
 *
 * Renders user-created custom sidebar groups with their assigned collections and singles.
 * Each custom group appears as its own SidebarGroup with a label and flat item list.
 * Groups with no assigned items are not rendered.
 */
export function DynamicCustomGroupNav({
  isActive,
  search = "",
}: DynamicCustomGroupNavProps) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const branding = useBranding();
  const { capabilities } = useCurrentUserPermissions();

  const customGroups = branding?.customGroups;

  const { data: collectionsData } = useCollections(
    {
      pagination: { page: 0, pageSize: 100 },
      sorting: [{ field: "name", direction: "asc" }],
      filters: {},
    },
    {
      staleTime: 5 * 60 * 1000,
    }
  );

  const { data: singlesData } = useSingles();

  // Build grouped items by deriving groups from collection/single data.
  // customGroups from admin-meta act as optional overrides for display name/icon.
  const groupedItems = useMemo(() => {
    // Capitalize first letter of a string
    const capitalizeFirstLetter = (str: string) => {
      if (!str) return str;
      return str.charAt(0).toUpperCase() + str.slice(1);
    };

    if (!customGroups || customGroups.length === 0) return [];

    const allCollections = collectionsData?.items ?? [];
    const allSingles = singlesData?.items ?? [];

    // Filter by permissions first
    const permittedCollections = filterCollectionItems(
      allCollections,
      capabilities
    );
    const permittedSingles = filterSingleItems(allSingles, capabilities);

    const lowerSearch = search.toLowerCase();

    return customGroups
      .map(group => {
        const items: GroupItem[] = [];

        for (const collection of permittedCollections) {
          const displayName =
            collection.labels?.plural || collection.label || collection.name;

          if (
            collection.admin?.sidebarGroup === group.slug &&
            !collection.admin?.hidden &&
            (!search || displayName.toLowerCase().includes(lowerSearch))
          ) {
            items.push({
              type: "collection",
              key: `col-${collection.id}`,
              label: capitalizeFirstLetter(
                collection.labels?.plural || collection.label || collection.name
              ),
              href: buildRoute(ROUTES.COLLECTION_ENTRIES, {
                slug: collection.name,
              }),
              icon: collection.admin?.icon || "Database",
              order: Number(collection.admin?.order) || 100,
            });
          }
        }

        for (const single of permittedSingles) {
          const displayName = single.label || single.slug;

          if (
            single.admin?.sidebarGroup === group.slug &&
            !single.admin?.hidden &&
            (!search || displayName.toLowerCase().includes(lowerSearch))
          ) {
            items.push({
              type: "single",
              key: `single-${single.slug}`,
              label: capitalizeFirstLetter(single.label || single.slug),
              href: buildRoute(ROUTES.SINGLE_EDIT, { slug: single.slug }),
              icon: single.admin?.icon || "",
              order: Number(single.admin?.order) || 100,
            });
          }
        }

        // Sort items by order then alphabetically
        items.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.label.localeCompare(b.label);
        });

        return { group, items };
      })
      .filter(entry => (search ? true : entry.items.length > 0)) // if searching, keep groups even if empty to show "No matching items"
      .filter(entry => (!search && entry.items.length === 0 ? false : true)) // hide empty groups if not searching
      .sort((a, b) => a.group.name.localeCompare(b.group.name));
  }, [customGroups, collectionsData, singlesData, capabilities, search]);

  if (groupedItems.length === 0) {
    return null;
  }

  return (
    <>
      {groupedItems.map(({ group, items }) => (
        <React.Fragment key={group.slug}>
          {/* Sub-group label within the parent Collections section */}
          {!isCollapsed && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 px-4 mt-3 mb-1 block">
              {group.name}
            </span>
          )}
          <SidebarMenu>
            {items.map(item => {
              const isItemActive = isActive(item.href);
              const DefaultIcon = item.type === "collection" ? Database : Globe;
              const IconComponent = iconMap[item.icon] || DefaultIcon;

              return (
                <SidebarMenuItem key={item.key}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton
                        asChild
                        isActive={isItemActive}
                        className={cn(!isCollapsed && "justify-start")}
                      >
                        <Link href={item.href}>
                          <IconComponent className={cn("h-4 w-4 shrink-0")} />
                          {!isCollapsed && <span>{item.label}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      hidden={!isCollapsed}
                      className="bg-black text-white"
                      style={{ backgroundColor: "black", color: "white" }}
                    >
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </React.Fragment>
      ))}
    </>
  );
}
