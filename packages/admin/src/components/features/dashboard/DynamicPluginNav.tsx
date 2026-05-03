"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@revnixhq/ui";
import React from "react";

import * as Icons from "@admin/components/icons";
import { ChevronDown, Package, Loader2 } from "@admin/components/icons";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@admin/components/layout/sidebar";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCollections } from "@admin/hooks/queries";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { filterCollectionItems } from "@admin/lib/permissions/authorization";
import { cn } from "@admin/lib/utils";
import type { ApiCollection } from "@admin/types/entities";

/**
 * Props for the DynamicPluginNav component
 */
interface DynamicPluginNavProps {
  /** Function to check if a route is active */
  isActive: (href?: string) => boolean;
  /** Search query to filter plugins */
  search?: string;
}

/**
 * Loading skeleton for plugin items
 */
function PluginSkeleton() {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton disabled className="opacity-50">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">Loading plugins...</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Derive a URL-friendly slug from a plugin group name.
 * e.g. "Form Builder" -> "form-builder"
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface PluginEntry {
  name: string;
  slug: string;
  /** Whether this plugin's items have been placed in another section */
  isPlaced: boolean;
  /** The plugin's collections (only shown when not placed) */
  collections: ApiCollection[];
}

/**
 * Dynamic Plugin Navigation Component
 *
 * Each installed plugin always appears in the Plugins section. Two rendering modes:
 * - **Default (not placed):** Expandable collapsible showing the plugin's collections/singles
 * - **Placed elsewhere:** Simple link to the plugin settings page (config only)
 */
export function DynamicPluginNav({
  isActive,
  search = "",
}: DynamicPluginNavProps) {
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

  // All plugin collections (including hidden), used to build plugin structure.
  const allPluginCollections = (data?.items ?? []).filter(
    collection => collection.admin?.isPlugin
  );

  // Visible plugin collections — filtered by hidden flag and user permissions
  const visiblePlugins = allPluginCollections.filter(
    collection => !collection.admin?.hidden
  );
  const pluginCollections = filterCollectionItems(visiblePlugins, capabilities);

  // Set of visible collection IDs for quick lookup
  const visibleCollectionIds = React.useMemo(
    () => new Set(pluginCollections.map(c => c.id)),
    [pluginCollections]
  );

  // Plugin-level metadata with declared placement
  const pluginMetadata = branding?.plugins;

  // Build a lookup: collection group slug → plugin metadata
  // Matches by checking if any collection in the group belongs to a plugin's collections list
  const groupToPluginMeta = React.useMemo(() => {
    const map = new Map<string, NonNullable<typeof pluginMetadata>[number]>();
    if (!pluginMetadata) return map;
    for (const meta of pluginMetadata) {
      const collectionSlugs = new Set(meta.collections ?? []);
      for (const collection of allPluginCollections) {
        if (collectionSlugs.has(collection.name)) {
          const groupSlug = toSlug(collection.admin?.group || "");
          if (groupSlug && !map.has(groupSlug)) {
            map.set(groupSlug, meta);
          }
        }
      }
    }
    return map;
  }, [pluginMetadata, allPluginCollections]);

  // Helper: determine if a plugin group is placed in another sidebar section
  // Uses config-only placement (no user overrides)
  const isPluginPlaced = React.useCallback(
    (slug: string): boolean => {
      const meta = groupToPluginMeta.get(slug);
      const placement = meta?.placement ?? meta?.group;
      if (!placement || placement === "plugins") return false;
      // "standalone" plugins get their own top-level sidebar icon, so treat as placed
      return true;
    },
    [groupToPluginMeta]
  );

  // Build plugin entries from ALL plugin collections (so the plugin always appears
  // with its Settings link), but only include visible collections as sub-items
  const plugins = React.useMemo(() => {
    const pluginMap = new Map<string, PluginEntry>();

    // Build plugin structure from ALL plugin collections (including hidden)
    for (const collection of allPluginCollections) {
      const groupName = collection.admin?.group || "Other";

      // Filter by search query if provided
      if (search && !groupName.toLowerCase().includes(search.toLowerCase())) {
        continue;
      }

      if (!pluginMap.has(groupName)) {
        const slug = toSlug(groupName);
        pluginMap.set(groupName, {
          name: groupName,
          slug,
          isPlaced: isPluginPlaced(slug),
          collections: [],
        });
      }

      // Only add to sub-items if the collection is visible and permitted
      if (visibleCollectionIds.has(collection.id)) {
        pluginMap.get(groupName)!.collections.push(collection);
      }
    }

    // Sort collections within each plugin by order then name
    for (const entry of pluginMap.values()) {
      entry.collections.sort((a, b) => {
        const orderA = a.admin?.order ?? 100;
        const orderB = b.admin?.order ?? 100;
        if (orderA !== orderB) return orderA - orderB;
        return (a.labels?.plural || a.label || a.name).localeCompare(
          b.labels?.plural || b.label || b.name
        );
      });
    }

    return Array.from(pluginMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [
    allPluginCollections,
    visibleCollectionIds,
    isPluginPlaced,
    search,
  ]);

  if (isLoading) {
    if (isCollapsed) return null;
    return <PluginSkeleton />;
  }

  if (error || plugins.length === 0) {
    return null;
  }

  const getPluginUrl = (slug: string) =>
    buildRoute(ROUTES.PLUGIN_SETTINGS, { slug });

  const getCollectionUrl = (collection: ApiCollection) =>
    buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: collection.name });

  const isAnyPluginActive = plugins.some(p => {
    if (isActive(getPluginUrl(p.slug))) return true;
    if (!p.isPlaced) {
      return p.collections.some(c => isActive(getCollectionUrl(c)));
    }
    return false;
  });

  // Collapsed mode: single icon with dropdown listing plugin names
  if (isCollapsed) {
    return (
      <CollapsedPluginDropdown
        plugins={plugins}
        isActive={isActive}
        isAnyActive={isAnyPluginActive}
        getPluginUrl={getPluginUrl}
      />
    );
  }

  // Expanded mode — use plugin metadata slug for the overview link
  const firstMetaSlug =
    pluginMetadata?.[0]?.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ?? plugins[0].slug;
  const overviewHref = getPluginUrl(firstMetaSlug);
  const isOverviewActive = isActive("/admin/plugins");

  // Plugins with unplaced collections (shown as expandable with collection sub-items)
  const pluginsWithCollections = plugins.filter(
    p => !p.isPlaced && p.collections.length > 0
  );

  return (
    <>
      {/* Installed Plugins overview link */}
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isOverviewActive}>
          <Link href={overviewHref}>
            <Package
              className={cn(
                "shrink-0",
                !isOverviewActive && "text-muted-foreground group-hover-unified"
              )}
            />
            <span>Installed Plugins</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>

      {/* Plugin collections (only for plugins not placed elsewhere) */}
      {pluginsWithCollections.map(plugin => {
        const isAnyChildActive = plugin.collections.some(c =>
          isActive(getCollectionUrl(c))
        );

        return (
          <Collapsible key={plugin.slug} asChild defaultOpen={isAnyChildActive}>
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton
                  tooltip={plugin.name}
                  isActive={isAnyChildActive}
                  className="group/trigger"
                >
                  <Package
                    className={cn(
                      "shrink-0",
                      !isAnyChildActive &&
                        "text-muted-foreground group-hover-unified"
                    )}
                  />
                  <span className="flex-1 truncate">{plugin.name}</span>
                  <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-300 ease-out group-data-[state=open]/trigger:rotate-180" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {plugin.collections.map(collection => {
                    const href = getCollectionUrl(collection);
                    const isSubActive = isActive(href);
                    const displayName =
                      collection.labels?.plural ||
                      collection.label ||
                      collection.name;
                    const iconName = collection.admin?.icon || "Database";
                    const IconComponent =
                      (Icons as Record<string, React.ElementType>)[iconName] ||
                      Icons.Database;

                    return (
                      <SidebarMenuSubItem key={collection.id}>
                        <SidebarMenuSubButton asChild isActive={isSubActive}>
                          <Link href={href}>
                            <IconComponent className="h-3.5 w-3.5 shrink-0" />
                            <span>{displayName}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        );
      })}
    </>
  );
}

/**
 * Collapsed sidebar: Package icon with hover dropdown showing plugin names
 */
function CollapsedPluginDropdown({
  plugins,
  isActive,
  isAnyActive,
  getPluginUrl,
}: {
  plugins: PluginEntry[];
  isActive: (href?: string) => boolean;
  isAnyActive: boolean;
  getPluginUrl: (slug: string) => string;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 100);
  };

  return (
    <SidebarMenuItem
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            isActive={isAnyActive}
            className="transition-none group-data-[collapsible=icon]:!p-2"
          >
            <Package
              className={cn(
                "shrink-0",
                !isAnyActive && "text-muted-foreground group-hover-unified"
              )}
            />
            <span className="sr-only">Plugins</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          className="w-56 ml-2 admin-dropdown-content shadow-xl shadow-black/5 border-primary/5"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <DropdownMenuLabel>Plugins</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {plugins.map(plugin => {
            const href = getPluginUrl(plugin.slug);
            const active = isActive(href);
            return (
              <DropdownMenuItem key={plugin.slug} asChild>
                <Link
                  href={href}
                  data-active={active ? "true" : undefined}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 transition-none admin-dropdown-item",
                    active && "!font-bold"
                  )}
                >
                  <Package className="h-4 w-4" />
                  <span>{plugin.name}</span>
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
