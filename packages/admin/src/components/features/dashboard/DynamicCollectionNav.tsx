"use client";
import type React from "react";

import { isRemovedFromCode } from "@admin/components/features/entries/removed-from-code-notice";
import {
  RemovedFromCodeDescription,
  RemovedFromCodeMark,
  removedFromCodeMarkId,
} from "@admin/components/features/entries/RemovedFromCodeNotice";
import { Bookmark } from "@admin/components/icons";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@admin/components/layout/sidebar";
import { PanelGhostRows } from "@admin/components/layout/sidebar/RailColumn";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useSidebarCollectionList } from "@admin/hooks/useSidebarContentLists";
import { collectionSidebarGroup } from "@admin/lib/content-groups";
import { contentIcon } from "@admin/lib/content-icons";
import {
  collectionDisplayName,
  searchSidebarCollections,
} from "@admin/lib/sidebar-landing";
import { cn } from "@admin/lib/utils";
import type { ApiCollection } from "@admin/types/entities";

/**
 * Props for the DynamicCollectionNav component
 */
interface DynamicCollectionNavProps {
  /** Function to check if a route is active */
  isActive: (href?: string) => boolean;
  /** Search query to filter collections */
  search?: string;
  /**
   * The `admin.sidebarGroup` whose collections to list, or null (the
   * default) for the collections that name no group. The Content panel draws
   * one list per group, each under its sub-heading.
   */
  group?: string | null;
}

/**
 * The panel's rows while the collections load: neutral shapes where the links
 * will be, still, so nothing in the panel spins or names a list not known yet.
 */
function CollectionSkeleton() {
  return <PanelGhostRows as="li" />;
}

/**
 * Dynamic Collection Navigation Component
 *
 * Lists the collections of one sidebar group (or of none) that match the
 * search, in the sidebar's order, each with its pin.
 */
export function DynamicCollectionNav({
  isActive,
  search = "",
  group = null,
}: DynamicCollectionNavProps): React.JSX.Element | null {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  // The listed collections, their pins and their search come from the hook and
  // helper the Content panel also reads, so its match count can't disagree.
  const {
    items: baseCollections,
    isLoading,
    error,
    isPinned,
    togglePin,
  } = useSidebarCollectionList();

  const collections = searchSidebarCollections(baseCollections, search).filter(
    collection => collectionSidebarGroup(collection) === group
  );

  if (isLoading) {
    if (isCollapsed) return null;
    return <CollectionSkeleton />;
  }
  if (error || collections.length === 0) {
    return null;
  }

  const getCollectionUrl = (collection: ApiCollection) => {
    return buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: collection.name });
  };

  return (
    <>
      {collections.map(collection => {
        const url = getCollectionUrl(collection);
        const isActiveItem = isActive(url);
        const collectionPinned = isPinned(collection.name);
        const displayName = collectionDisplayName(collection);

        // The icon it names, else the list that marks a collection.
        const IconComponent = contentIcon("collection", collection.admin?.icon);
        // A collection removed from code stays listed, marked, with the step
        // that retires it as the link's description.
        const removed = isRemovedFromCode(collection)
          ? {
              entity: {
                kind: "collection" as const,
                label: displayName,
                slug: collection.name,
              },
              state: collection.removedFromCodeState,
            }
          : null;

        return (
          <SidebarMenuItem key={collection.id}>
            <SidebarMenuButton
              asChild
              tooltip={displayName}
              isActive={isActiveItem}
            >
              <Link
                href={url}
                aria-describedby={
                  removed ? removedFromCodeMarkId(removed.entity) : undefined
                }
              >
                <IconComponent
                  aria-hidden="true"
                  className={cn(
                    "h-4 w-4 shrink-0",
                    !isActiveItem && "text-muted-foreground"
                  )}
                />
                {!isCollapsed && (
                  <>
                    {/* Truncated itself: the button truncates only its last
                        span, which the mark would otherwise be. */}
                    <span className="min-w-0 truncate">{displayName}</span>
                    {removed ? <RemovedFromCodeMark {...removed} /> : null}
                  </>
                )}
              </Link>
            </SidebarMenuButton>
            {removed ? <RemovedFromCodeDescription {...removed} /> : null}
            {!isCollapsed && (
              <SidebarMenuAction
                showOnHover={!collectionPinned}
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePin(collection.name);
                  e.currentTarget.blur();
                }}
                aria-label={
                  collectionPinned ? "Unpin collection" : "Pin collection"
                }
                aria-pressed={collectionPinned}
                title={collectionPinned ? "Unpin collection" : "Pin collection"}
                className={
                  collectionPinned
                    ? "opacity-100 text-sidebar-accent-foreground"
                    : ""
                }
              >
                <Bookmark
                  className={
                    collectionPinned
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
