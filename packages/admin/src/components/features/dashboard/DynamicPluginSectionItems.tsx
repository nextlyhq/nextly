"use client";

import { Badge } from "@revnixhq/ui";
import React from "react";

import * as Icons from "@admin/components/icons";
import { Database } from "@admin/components/icons";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@admin/components/layout/sidebar";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCollections } from "@admin/hooks/queries";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { filterCollectionItems } from "@admin/lib/permissions/authorization";
import type { PluginMetadata } from "@admin/types/branding";
import type { ApiCollection } from "@admin/types/entities";

/**
 * Derive a URL-friendly slug from a name.
 * e.g. "Form Builder" -> "form-builder"
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface PluginGroup {
  meta: PluginMetadata;
  slug: string;
  collections: ApiCollection[];
}

interface DynamicPluginSectionItemsProps {
  /** The placement to filter by (e.g. "users", "settings") */
  placement: string;
  /** Function to check if a route is active */
  isActive: (href?: string, exact?: boolean) => boolean;
}

/**
 * Renders plugin collections placed in a specific sidebar section.
 *
 * Each matching plugin gets a sub-label, followed by its visible collections
 * as standard SidebarMenuItem entries. Returns null if no plugins match.
 */
export function DynamicPluginSectionItems({
  placement,
  isActive,
}: DynamicPluginSectionItemsProps) {
  const { capabilities } = useCurrentUserPermissions();
  const branding = useBranding();
  const pluginMetadata = branding?.plugins;

  const { data } = useCollections(
    {
      pagination: { page: 0, pageSize: 100 },
      sorting: [{ field: "name", direction: "asc" }],
      filters: {},
    },
    { staleTime: 5 * 60 * 1000 }
  );

  const pluginGroups = React.useMemo(() => {
    if (!pluginMetadata || !data?.items) return [];

    // Find plugins whose effective placement matches the target
    const matchingPlugins = pluginMetadata.filter(meta => {
      const effectivePlacement = meta.placement ?? meta.group;
      return effectivePlacement === placement;
    });

    if (matchingPlugins.length === 0) return [];

    // Get all plugin collections, filtered by visibility and permissions
    const allCollections = data.items;
    const visiblePluginCollections = allCollections.filter(
      c => c.admin?.isPlugin && !c.admin?.hidden
    );
    const permittedCollections = filterCollectionItems(
      visiblePluginCollections,
      capabilities
    );

    // Group collections by their plugin (match by collections list)
    const groups: PluginGroup[] = [];
    for (const meta of matchingPlugins) {
      const slug = toSlug(meta.name);
      const pluginCollectionSlugs = new Set(meta.collections ?? []);
      const collections = permittedCollections
        .filter(c => pluginCollectionSlugs.has(c.name))
        .sort((a, b) => {
          const orderA = a.admin?.order ?? 100;
          const orderB = b.admin?.order ?? 100;
          if (orderA !== orderB) return orderA - orderB;
          return (a.labels?.plural || a.label || a.name).localeCompare(
            b.labels?.plural || b.label || b.name
          );
        });

      if (collections.length > 0) {
        groups.push({ meta, slug, collections });
      }
    }

    // Sort plugins by order then alphabetically
    groups.sort((a, b) => {
      const orderA = a.meta.order ?? 100;
      const orderB = b.meta.order ?? 100;
      if (orderA !== orderB) return orderA - orderB;
      return a.meta.name.localeCompare(b.meta.name);
    });

    return groups;
  }, [pluginMetadata, data?.items, placement, capabilities]);

  if (pluginGroups.length === 0) return null;

  const badgeVariantMap: Record<
    string,
    "default" | "primary" | "success" | "warning" | "destructive" | "outline"
  > = {
    default: "default",
    secondary: "default",
    destructive: "destructive",
    outline: "outline",
  };

  return (
    <>
      {pluginGroups.map(group => {
        const label = group.meta.appearance?.label ?? group.meta.name;
        const badge = group.meta.appearance?.badge;
        const badgeVariant =
          badgeVariantMap[group.meta.appearance?.badgeVariant ?? "default"] ??
          "default";

        return (
          <React.Fragment key={group.slug}>
            {/* Plugin sub-label */}
            <div className="space-y-1 mt-4">
              <div className="flex items-center gap-2 px-3 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {label}
                </p>
                {badge && (
                  <Badge
                    variant={badgeVariant}
                    className="h-4 text-[9px] px-1.5 py-0"
                  >
                    {badge}
                  </Badge>
                )}
              </div>
              <SidebarMenu>
                {group.collections.map(collection => {
                  const href = buildRoute(ROUTES.COLLECTION_ENTRIES, {
                    slug: collection.name,
                  });
                  const isActiveItem = isActive(href);
                  const displayName =
                    collection.labels?.plural ||
                    collection.label ||
                    collection.name;

                  // Resolve icon: collection icon > plugin appearance icon > Database default
                  const iconName =
                    collection.admin?.icon ||
                    group.meta.appearance?.icon ||
                    "Database";
                  const IconComponent =
                    (Icons as Record<string, React.ElementType>)[iconName] ||
                    Database;

                  return (
                    <SidebarMenuItem key={collection.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActiveItem}
                        className="justify-start px-3"
                      >
                        <Link href={href}>
                          <IconComponent className="h-4 w-4" />
                          <span>{displayName}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
}
