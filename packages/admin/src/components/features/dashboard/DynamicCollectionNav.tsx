"use client";
import type React from "react";
import { useMemo, useCallback } from "react";

import * as Icons from "@admin/components/icons";
import {
  Bookmark,
  Loader2,
  type LucideIcon,
} from "@admin/components/icons";
import {
  SidebarMenuAction,
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
import { usePluginAutoRegistration } from "@admin/hooks/usePluginAutoRegistration";
import { useSidebarPins } from "@admin/hooks/useSidebarPins";
import {
  filterCollectionItems,
  filterSingleItems,
} from "@admin/lib/permissions/authorization";
import type { ApiCollection } from "@admin/types/entities";

const _iconMap = Icons as unknown as Record<string, LucideIcon>;
const BUILTIN_GROUPS = ["collections", "singles"];
/**
 * Props for the DynamicCollectionNav component
 */
interface DynamicCollectionNavProps {
  /** Function to check if a route is active */
  isActive: (href?: string) => boolean;
  /** Search query to filter collections */
  search?: string;
}

const PINNED_COLLECTIONS_STORAGE_KEY = "nextly:sidebar:pinned-collections";

/**
 * Loading skeleton for collection items
 */
function CollectionSkeleton() {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton disabled className="opacity-50">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">Loading collections...</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
/** A single sidebar entry (collection or single within a group) */
interface SidebarEntry {
  type: "collection" | "single";
  key: string;
  label: string;
  href: string;
  icon: string;
  order: number;
}
/** A sortable section: either a standalone item or a named group */
type SidebarSection =
  | { kind: "item"; entry: SidebarEntry; order: number }
  | {
      kind: "group";
      slug: string;
      name: string;
      items: SidebarEntry[];
      order: number;
    };
/**
 * Dynamic Collection Navigation Component
 *
 * Renders both ungrouped collections and custom sidebar groups in a single
 * ordered list. Groups are interleaved with ungrouped items based on the
 * minimum `admin.order` of their members, so a group with order 2 can
 * appear above an ungrouped collection with order 100.
 */
export function DynamicCollectionNav({
  isActive,
  search = "",
}: DynamicCollectionNavProps) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { capabilities } = useCurrentUserPermissions();
  const branding = useBranding();
  const { data, isLoading, error } = useCollections(
    {
      pagination: { page: 0, pageSize: 100 },
      sorting: [{ field: "name", direction: "asc" }],
      filters: {},
    },
    {
      staleTime: 5 * 60 * 1000,
    }
  );

  const {
    pinned: pinnedCollections,
    isPinned,
    togglePin,
  } = useSidebarPins({
    storageKey: PINNED_COLLECTIONS_STORAGE_KEY,
  });

  const { data: singlesData } = useSingles();
  usePluginAutoRegistration(data?.items);
  // Plugin-level metadata with declared placement
  const pluginMetadata = branding?.plugins;
  const customGroups = branding?.customGroups;
  /**
   * Resolve the effective sidebar placement for a plugin collection.
   * Matches by checking if the collection's name/slug appears in a
   * plugin's collections list, then returns that plugin's placement.
   * Priority: 1. Plugin metadata placement  2. Plugin metadata group (deprecated)  3. undefined (stays in Plugins)
   */
  const getPluginPlacement = useCallback(
    (collection: ApiCollection): string | undefined => {
      if (!pluginMetadata) return undefined;
      const meta = pluginMetadata.find(p =>
        (p.collections ?? []).includes(collection.name)
      );
      return meta?.placement ?? meta?.group ?? undefined;
    },
    [pluginMetadata]
  );

  // Filter to collections belonging to the "Collections" sidebar group
  const visibleCollections = (data?.items ?? []).filter(collection => {
    if (collection.admin?.hidden) return false;

    // Filter by search query if provided
    if (search) {
      const displayName = (
        collection.labels?.plural ||
        collection.label ||
        collection.name
      ).toLowerCase();
      if (!displayName.includes(search.toLowerCase())) return false;
    }

    const group = collection.admin?.sidebarGroup;
    // Explicitly assigned to "collections" group
    if (group === "collections") return true;
    // Default collections: no group assigned and not a plugin
    if (!group && !collection.admin?.isPlugin) return true;
    // Plugin collections placed in "collections" via placement override or declared group
    if (collection.admin?.isPlugin) {
      return getPluginPlacement(collection) === "collections";
    }
    return false;
  });

  // Filter by user permissions (only show collections the user can read)
  const permittedCollections = filterCollectionItems(
    visibleCollections,
    capabilities
  );

  // Sort by admin.order (ascending, default 100), then alphabetically by label
  const collections = [...permittedCollections].sort((a, b) => {
    const aPinned = pinnedCollections.has(a.name);
    const bPinned = pinnedCollections.has(b.name);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;

    const orderA = a.admin?.order ?? 100;
    const orderB = b.admin?.order ?? 100;
    if (orderA !== orderB) return orderA - orderB;
    return (a.labels?.plural || a.label || a.name).localeCompare(
      b.labels?.plural || b.label || b.name
    );
  });

  // Build the unified sorted sections list
  const sections = useMemo(() => {
    const allCollections = data?.items ?? [];
    const allSingles = singlesData?.items ?? [];
    // --- Ungrouped collections (belong to default "Collections" section) ---
    const ungroupedVisible = allCollections.filter(collection => {
      if (collection.admin?.hidden) return false;
      const group = collection.admin?.sidebarGroup;
      if (group === "collections") return true;
      if (!group && !collection.admin?.isPlugin) return true;
      if (collection.admin?.isPlugin) {
        return getPluginPlacement(collection) === "collections";
      }
      return false;
    });
    const ungroupedPermitted = filterCollectionItems(
      ungroupedVisible,
      capabilities
    );
    const ungroupedSections: SidebarSection[] = ungroupedPermitted.map(c => ({
      kind: "item",
      order: Number(c.admin?.order) || 100,
      entry: {
        type: "collection",
        key: `col-${c.id}`,
        label: c.labels?.plural || c.label || c.name,
        href: buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: c.name }),
        icon: c.admin?.icon || "Database",
        order: Number(c.admin?.order) || 100,
        migrationStatus: c.migrationStatus,
      },
    }));
    // --- Custom groups (derived from sidebarGroup field) ---
    const permittedCollections = filterCollectionItems(
      allCollections,
      capabilities
    );
    const permittedSingles = filterSingleItems(allSingles, capabilities);
    // Discover all unique custom sidebarGroup slugs
    const discoveredSlugs = new Set<string>();
    for (const c of permittedCollections) {
      const sg = c.admin?.sidebarGroup;
      if (sg && !BUILTIN_GROUPS.includes(sg)) discoveredSlugs.add(sg);
    }
    for (const s of permittedSingles) {
      const sg = s.admin?.sidebarGroup;
      if (sg && !BUILTIN_GROUPS.includes(sg)) discoveredSlugs.add(sg);
    }
    // Build group display name lookup from admin-meta customGroups
    const groupOverrides = new Map<string, { name: string; icon?: string }>();
    for (const g of customGroups ?? []) {
      groupOverrides.set(g.slug, { name: g.name, icon: g.icon });
    }
    const groupSections: SidebarSection[] = Array.from(discoveredSlugs)
      .map(slug => {
        const override = groupOverrides.get(slug);
        const groupName =
          override?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1);
        const items: SidebarEntry[] = [];
        for (const collection of permittedCollections) {
          if (
            collection.admin?.sidebarGroup === slug &&
            !collection.admin?.hidden
          ) {
            items.push({
              type: "collection",
              key: `col-${collection.id}`,
              label:
                collection.labels?.plural ||
                collection.label ||
                collection.name,
              href: buildRoute(ROUTES.COLLECTION_ENTRIES, {
                slug: collection.name,
              }),
              icon: collection.admin?.icon || "Database",
              order: Number(collection.admin?.order) || 100,
            });
          }
        }
        for (const single of permittedSingles) {
          if (single.admin?.sidebarGroup === slug && !single.admin?.hidden) {
            items.push({
              type: "single",
              key: `single-${single.slug}`,
              label: single.label || single.slug,
              href: buildRoute(ROUTES.SINGLE_EDIT, { slug: single.slug }),
              icon: single.admin?.icon || "",
              order: Number(single.admin?.order) || 100,
            });
          }
        }
        // Sort items within the group
        items.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.label.localeCompare(b.label);
        });
        // Group's sort order = minimum order of its members
        const groupOrder =
          items.length > 0 ? Math.min(...items.map(i => i.order)) : 100;
        return {
          kind: "group" as const,
          slug,
          name: groupName,
          items,
          order: groupOrder,
        };
      })
      .filter(g => g.items.length > 0);
    // Merge and sort all sections by order, then alphabetically
    const allSections: SidebarSection[] = [
      ...ungroupedSections,
      ...groupSections,
    ];
    allSections.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      const nameA = a.kind === "item" ? a.entry.label : a.name;
      const nameB = b.kind === "item" ? b.entry.label : b.name;
      return nameA.localeCompare(nameB);
    });
    return allSections;
  }, [data, singlesData, capabilities, customGroups, getPluginPlacement]);
  if (isLoading) {
    if (isCollapsed) return null;
    return <CollectionSkeleton />;
  }
  if (error || sections.length === 0) {
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
        const displayName =
          collection.labels?.plural || collection.label || collection.name;

        const iconName = collection.admin?.icon || "Database";
        const IconComponent =
          (Icons as Record<string, React.ElementType>)[iconName] ||
          Icons.Database;

        return (
          <SidebarMenuItem key={collection.id}>
            <SidebarMenuButton
              asChild
              tooltip={displayName}
              isActive={isActiveItem}
            >
              <Link href={url}>
                <IconComponent className="h-4 w-4 shrink-0" />
                {!isCollapsed && (
                  <>
                    <span>{displayName}</span>
                  </>
                )}
              </Link>
            </SidebarMenuButton>
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
                className={collectionPinned ? "opacity-100 text-primary" : ""}
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
