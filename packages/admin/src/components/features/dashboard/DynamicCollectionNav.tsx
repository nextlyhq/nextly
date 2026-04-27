"use client";
import React, { useMemo } from "react";

import * as Icons from "@admin/components/icons";
import {
  Database,
  Bookmark,
  Globe,
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

const iconMap = Icons as unknown as Record<string, LucideIcon>;
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
/**
 * Empty state when no collections exist
 */
function EmptyCollections({ hasSearch }: { hasSearch?: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton disabled className="opacity-60">
        <Database className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground text-sm">
          {hasSearch ? "No matching collections" : "No collections"}
        </span>
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
  collectionName?: string; // For collections: the collection name
  singleSlug?: string; // For singles: the single slug
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
 * Renders default (ungrouped) collections first, then custom sidebar groups.
 * This mirrors DynamicSingleNav behavior so non-grouped items are always at
 * the top of this section.
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
  usePluginAutoRegistration(data?.data);
  // Plugin-level metadata with declared placement
  const pluginMetadata = branding?.plugins;
  const customGroups = branding?.customGroups;
  /**
   * Resolve the effective sidebar placement for a plugin collection.
   * Matches by checking if the collection's name/slug appears in a
   * plugin's collections list, then returns that plugin's placement.
   * Priority: 1. Plugin metadata placement  2. Plugin metadata group (deprecated)  3. undefined (stays in Plugins)
   */
  const getPluginPlacement = (
    collection: ApiCollection
  ): string | undefined => {
    if (!pluginMetadata) return undefined;
    const meta = pluginMetadata.find(p =>
      (p.collections ?? []).includes(collection.name)
    );
    return meta?.placement ?? meta?.group ?? undefined;
  };

  // Build the unified sorted sections list
  const sections = useMemo(() => {
    const allCollections = data?.data ?? [];
    const allSingles = singlesData?.data ?? [];
    const lowerSearch = search.toLowerCase();

    const matchesSearch = (label: string) => {
      if (!search) return true;
      return label.toLowerCase().includes(lowerSearch);
    };

    // --- Ungrouped collections (belong to default "Collections" section) ---
    const ungroupedVisible = allCollections.filter(collection => {
      if (collection.admin?.hidden) return false;
      const displayName =
        collection.labels?.plural || collection.label || collection.name;
      if (!matchesSearch(displayName)) return false;

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
    const sortedUngrouped = [...ungroupedPermitted].sort((a, b) => {
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

    const ungroupedSections: SidebarSection[] = sortedUngrouped.map(c => ({
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
        collectionName: c.name,
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
          const displayName =
            collection.labels?.plural || collection.label || collection.name;
          if (
            collection.admin?.sidebarGroup === slug &&
            !collection.admin?.hidden &&
            matchesSearch(displayName)
          ) {
            items.push({
              type: "collection",
              key: `col-${collection.id}`,
              label: displayName,
              href: buildRoute(ROUTES.COLLECTION_ENTRIES, {
                slug: collection.name,
              }),
              icon: collection.admin?.icon || "Database",
              order: Number(collection.admin?.order) || 100,
              collectionName: collection.name,
            });
          }
        }
        for (const single of permittedSingles) {
          const displayName = single.label || single.slug;
          if (
            single.admin?.sidebarGroup === slug &&
            !single.admin?.hidden &&
            matchesSearch(displayName)
          ) {
            items.push({
              type: "single",
              key: `single-${single.slug}`,
              label: displayName,
              href: buildRoute(ROUTES.SINGLE_EDIT, { slug: single.slug }),
              icon: single.admin?.icon || "",
              order: Number(single.admin?.order) || 100,
              singleSlug: single.slug,
            });
          }
        }
        // Sort items within the group
        items.sort((a, b) => {
          const aPinned =
            a.type === "collection"
              ? pinnedCollections.has(a.collectionName!)
              : pinnedCollections.has(a.singleSlug!);
          const bPinned =
            b.type === "collection"
              ? pinnedCollections.has(b.collectionName!)
              : pinnedCollections.has(b.singleSlug!);
          if (aPinned !== bPinned) return aPinned ? -1 : 1;

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
    // Keep ungrouped items at the top, then custom groups below.
    groupSections.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      const nameA = a.kind === "group" ? a.name : "";
      const nameB = b.kind === "group" ? b.name : "";
      return nameA.localeCompare(nameB);
    });

    return [...ungroupedSections, ...groupSections];
  }, [
    data,
    singlesData,
    capabilities,
    pluginMetadata,
    customGroups,
    search,
    pinnedCollections,
  ]);
  if (isLoading) {
    if (isCollapsed) return null;
    return <CollectionSkeleton />;
  }
  if (error) {
    return null;
  }
  if (sections.length === 0) {
    if (isCollapsed) return null;
    return <EmptyCollections hasSearch={Boolean(search)} />;
  }

  return (
    <>
      {sections.map(section => {
        if (section.kind === "item") {
          return (
            <CollectionItem
              key={section.entry.key}
              entry={section.entry}
              isActive={isActive}
              isCollapsed={isCollapsed}
              isPinned={isPinned}
              togglePin={togglePin}
            />
          );
        }

        return (
          <React.Fragment key={`group-${section.slug}`}>
            {!isCollapsed && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 px-4 mt-3 mb-1 block">
                {section.name}
              </span>
            )}
            {section.items.map(item => (
              <CollectionItem
                key={item.key}
                entry={item}
                isActive={isActive}
                isCollapsed={isCollapsed}
                isPinned={isPinned}
                togglePin={togglePin}
              />
            ))}
          </React.Fragment>
        );
      })}
    </>
  );
}
/** Renders a single collection/single item in the sidebar */
function CollectionItem({
  entry,
  isActive,
  isCollapsed,
  isPinned,
  togglePin,
}: {
  entry: SidebarEntry;
  isActive: (href?: string) => boolean;
  isCollapsed: boolean;
  isPinned: (resource: string) => boolean;
  togglePin: (resource: string) => void;
}) {
  // Capitalize first letter of a string
  const capitalizeFirstLetter = (str: string) => {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const isActiveItem = isActive(entry.href);
  const DefaultIcon = entry.type === "collection" ? Database : Globe;
  const IconComponent = iconMap[entry.icon] || DefaultIcon;
  const displayLabel = capitalizeFirstLetter(entry.label);

  // Determine if this entry is pinned and what resource ID to use
  const resourceId =
    entry.type === "collection" ? entry.collectionName : entry.singleSlug;
  const isPinnedItem = resourceId ? isPinned(resourceId) : false;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={displayLabel} isActive={isActiveItem}>
        <Link href={entry.href}>
          <IconComponent className="h-4 w-4 shrink-0" />
          {!isCollapsed && (
            <>
              <span>{displayLabel}</span>
            </>
          )}
        </Link>
      </SidebarMenuButton>
      {!isCollapsed && resourceId && (
        <SidebarMenuAction
          showOnHover={!isPinnedItem}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            togglePin(resourceId);
            e.currentTarget.blur();
          }}
          aria-label={isPinnedItem ? "Unpin" : "Pin"}
          aria-pressed={isPinnedItem}
          title={isPinnedItem ? "Unpin" : "Pin"}
          className={isPinnedItem ? "opacity-100 text-primary" : ""}
        >
          <Bookmark
            className={
              isPinnedItem
                ? "h-4 w-4 fill-current cursor-pointer"
                : "cursor-pointer"
            }
          />
        </SidebarMenuAction>
      )}
    </SidebarMenuItem>
  );
}
