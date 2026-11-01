"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@nextlyhq/ui";
import React from "react";

import { isRemovedFromCode } from "@admin/components/features/entries/removed-from-code-notice";
import {
  RemovedFromCodeDescription,
  RemovedFromCodeMark,
  removedFromCodeMarkId,
} from "@admin/components/features/entries/RemovedFromCodeNotice";
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
import { useSidebarSingleList } from "@admin/hooks/useSidebarContentLists";
import {
  searchSidebarSingles,
  singleDisplayName,
} from "@admin/lib/sidebar-landing";
import { cn } from "@admin/lib/utils";

interface DynamicSingleNavProps {
  isActive: (href?: string) => boolean;
  /** Search query to filter singles */
  search?: string;
}

const iconMap = Icons as unknown as Record<string, LucideIcon>;

/**
 * DynamicSingleNav Component
 *
 * Renders each Single entity directly in the sidebar for easy access.
 * Each item links directly to its content editing page.
 */

export function DynamicSingleNav({
  isActive,
  search = "",
}: DynamicSingleNavProps): React.JSX.Element | null {
  // The listed Singles, their pins and their search come from the hook and
  // helper the Content panel also reads, so its match count can't disagree.
  const {
    items: baseSingles,
    isLoading,
    isPinned,
    togglePin,
  } = useSidebarSingleList();

  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const singles = searchSidebarSingles(baseSingles, search);

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
        const displayName = singleDisplayName(single);
        // A Single removed from code stays listed, marked, with the step that
        // retires it as the link's description.
        const removed = isRemovedFromCode(single)
          ? {
              entity: {
                kind: "single" as const,
                label: displayName,
                slug: single.slug,
              },
              state: single.removedFromCodeState,
            }
          : null;

        return (
          <SidebarMenuItem key={single.slug}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarMenuButton
                  asChild
                  isActive={isItemActive}
                  className={cn(!isCollapsed && "justify-start")}
                >
                  <Link
                    href={href}
                    aria-describedby={
                      removed
                        ? removedFromCodeMarkId(removed.entity)
                        : undefined
                    }
                  >
                    {React.createElement(
                      iconMap[single.admin?.icon || ""] || Globe,
                      {
                        className: cn("h-4 w-4 shrink-0"),
                      }
                    )}
                    {/* Truncated itself: the button truncates only its last
                        span, which the mark would otherwise be. */}
                    {!isCollapsed && (
                      <span className="min-w-0 truncate">{displayName}</span>
                    )}
                    {!isCollapsed && removed ? (
                      <RemovedFromCodeMark {...removed} />
                    ) : null}
                  </Link>
                </SidebarMenuButton>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                hidden={!isCollapsed}
                className="bg-primary text-primary-foreground"
              >
                {displayName}
              </TooltipContent>
            </Tooltip>
            {removed ? <RemovedFromCodeDescription {...removed} /> : null}
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
                className={
                  singlePinned
                    ? "opacity-100 text-sidebar-accent-foreground"
                    : ""
                }
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
