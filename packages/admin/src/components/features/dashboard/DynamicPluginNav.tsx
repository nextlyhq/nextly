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
} from "@nextlyhq/ui";
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
import { isCollectionPlacedElsewhere } from "@admin/lib/plugins/collection-placement";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
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
 * The Installed Plugins entry.
 *
 * One implementation, used while collections load and after they settle. The
 * link reads admin-meta only, so it is available in both states, and rendering
 * it twice from two places is how the two would drift.
 */
function PluginOverviewLink({
  isActive,
}: {
  isActive: (href?: string, exactMatch?: boolean) => boolean;
}) {
  // Exact: `/admin/plugins` is a prefix of `/admin/plugins/browse`, and the
  // default match treats every descendant as active, so both sibling entries
  // would highlight at once for anyone on the directory.
  const active = isActive("/admin/plugins", true);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
        <Link href={ROUTES.PLUGINS}>
          <Package
            className={cn("shrink-0", !active && "text-muted-foreground")}
          />
          <span>Installed Plugins</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
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

interface PluginEntry {
  name: string;
  slug: string;
  /**
   * The plugin's collections that belong under Plugins. Empty when every one
   * of them is rendered in another section, which is what makes a group
   * unrenderable here — there is no separate placement flag to disagree with.
   */
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

  // `error` is deliberately not read. The two things this panel renders have
  // different data sources: collection entries come from this query, and the
  // overview link comes from admin-meta, so a collections failure must not
  // remove the overview link — on mobile it is the only sidebar route to
  // /admin/plugins.
  //
  // Whether the collection entries survive is `data`'s business, not this
  // flag's. A failed background refetch keeps the last successful result, so
  // the entries stay; only a first load that never succeeded leaves `data`
  // empty. Reading `error` here would blank the entries in the first case too,
  // replacing a still-accurate list with nothing.
  const { data, isLoading } = useCollections(
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
        const slug = pluginSlug(groupName);
        pluginMap.set(groupName, {
          name: groupName,
          slug,
          collections: [],
        });
      }

      // A sub-item must be visible, permitted, and not already rendered in
      // another section. Placement is declared per collection and read from the
      // plugin that owns it, so a collection carrying no `admin.group` heading
      // is still placed: the heading groups collections for display and says
      // nothing about which section owns them.
      if (
        visibleCollectionIds.has(collection.id) &&
        !isCollectionPlacedElsewhere(collection.name, pluginMetadata)
      ) {
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
  }, [allPluginCollections, visibleCollectionIds, pluginMetadata, search]);

  // The overview link is shown only to users who can open the page it points
  // at: /admin/plugins is manage-settings guarded, and a collection reader
  // opens this panel to reach their plugin's collections. Linking them to a
  // route that redirects would replace working navigation with a bounce.
  const canOpenOverview = capabilities.canManageSettings;

  if (isLoading) {
    if (isCollapsed) return null;
    // The skeleton stands in for the collection entries only. The overview
    // link reads admin-meta, which has already resolved, so replacing the whole
    // panel would make /admin/plugins unreachable for as long as a slow or
    // hung collections request lasts — and on mobile the rail item is a button
    // that opens this panel rather than navigating, so there is no other way in.
    return (
      <>
        {canOpenOverview && <PluginOverviewLink isActive={isActive} />}
        <PluginSkeleton />
      </>
    );
  }

  // A collections failure does NOT suppress the overview link. That
  // destination reads admin-meta, not collections, so it is still reachable;
  // only the collection-derived entries below are lost. On mobile the primary
  // plugins icon is a button that opens this panel rather than navigating, so
  // suppressing the link here would leave a settings manager with no route to
  // the page during an unrelated API failure.
  //
  // Nothing to offer at all is the one case that renders nothing.
  if (!canOpenOverview && plugins.length === 0) {
    return null;
  }

  const getPluginUrl = (slug: string) =>
    buildRoute(ROUTES.PLUGIN_DETAIL, { slug });

  const getCollectionUrl = (collection: ApiCollection) =>
    buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: collection.name });

  const isAnyPluginActive =
    isActive("/admin/plugins") ||
    plugins.some(p => {
      if (isActive(getPluginUrl(p.slug))) return true;
      return p.collections.some(c => isActive(getCollectionUrl(c)));
    });

  // Collapsed mode: single icon with dropdown listing the overview + plugin names
  if (isCollapsed) {
    return (
      <CollapsedPluginDropdown
        plugins={plugins}
        isActive={isActive}
        isAnyActive={isAnyPluginActive}
        getPluginUrl={getPluginUrl}
        getCollectionUrl={getCollectionUrl}
        canOpenPluginPages={canOpenOverview}
      />
    );
  }

  // A group is expandable exactly when it retains a collection to expand into.
  // Two plugins can share a display group — every group-less collection lands
  // under "Other" — so one of them being placed elsewhere says nothing about
  // the group, and a group-level answer would hide the other plugin's
  // reachable collection behind a rail item that opens an empty panel.
  const pluginsWithCollections = plugins.filter(p => p.collections.length > 0);

  return (
    <>
      {/* Installed Plugins overview link, for users who can open that page */}
      {canOpenOverview && <PluginOverviewLink isActive={isActive} />}

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
                      !isAnyChildActive && "text-muted-foreground"
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
  getCollectionUrl,
  canOpenPluginPages,
}: {
  plugins: PluginEntry[];
  isActive: (href?: string) => boolean;
  isAnyActive: boolean;
  getPluginUrl: (slug: string) => string;
  getCollectionUrl: (collection: ApiCollection) => string;
  /**
   * Whether this user can open `/admin/plugins` and the per-plugin detail
   * pages, both guarded by `manage-settings`. When false the dropdown offers
   * the plugin's collections instead, which are what such a user came here to
   * reach; listing the guarded pages would make every item a redirect.
   */
  canOpenPluginPages: boolean;
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
            className="transition-none group-data-[collapsible=icon]:p-2!"
          >
            <Package
              className={cn(
                "shrink-0",
                !isAnyActive && "text-muted-foreground"
              )}
            />
            <span className="sr-only">Plugins</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          className="w-56 ml-2 admin-dropdown-content shadow-xl shadow-(color:--nx-shadow-color)/5 border-border"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <DropdownMenuLabel>Plugins</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* The overview stays reachable even when no plugin owns a
              collection: metadata-only plugins are listed there. */}
          {canOpenPluginPages && (
            <DropdownMenuItem asChild>
              <Link
                href={ROUTES.PLUGINS}
                data-active={isActive(ROUTES.PLUGINS) ? "true" : undefined}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 transition-none admin-dropdown-item",
                  isActive(ROUTES.PLUGINS) && "font-bold!"
                )}
              >
                <Package className="h-4 w-4" />
                <span>Installed Plugins</span>
              </Link>
            </DropdownMenuItem>
          )}
          {plugins.flatMap(plugin => {
            // A user who can open plugin pages navigates by plugin. One who
            // cannot navigates to the collections themselves, which are the
            // only destinations here they are permitted to reach.
            if (canOpenPluginPages) {
              const href = getPluginUrl(plugin.slug);
              const active = isActive(href);
              return [
                <DropdownMenuItem key={plugin.slug} asChild>
                  <Link
                    href={href}
                    data-active={active ? "true" : undefined}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 transition-none admin-dropdown-item",
                      active && "font-bold!"
                    )}
                  >
                    <Package className="h-4 w-4" />
                    <span>{plugin.name}</span>
                  </Link>
                </DropdownMenuItem>,
              ];
            }
            // No placement check here: `plugin.collections` already excludes
            // anything rendered in another section, so both this menu and the
            // expanded view list the same set.
            return plugin.collections.map(collection => {
              const href = getCollectionUrl(collection);
              const active = isActive(href);
              const label =
                collection.labels?.plural ||
                collection.label ||
                collection.name;
              return (
                <DropdownMenuItem key={collection.id} asChild>
                  <Link
                    href={href}
                    data-active={active ? "true" : undefined}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 transition-none admin-dropdown-item",
                      active && "font-bold!"
                    )}
                  >
                    <Package className="h-4 w-4" />
                    <span>{label}</span>
                  </Link>
                </DropdownMenuItem>
              );
            });
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
