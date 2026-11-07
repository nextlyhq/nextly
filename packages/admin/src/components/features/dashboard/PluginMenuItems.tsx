"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nextlyhq/ui";
import type React from "react";

import * as Icons from "@admin/components/icons";
import { ChevronDown, Package } from "@admin/components/icons";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@admin/components/layout/sidebar";
import { Link } from "@admin/components/ui/link";
import type { ActiveNavSection } from "@admin/constants/nav-sections";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import {
  menuItemsMatching,
  resolveVisibleMenuItems,
} from "@admin/lib/plugins/menu";
import { cn } from "@admin/lib/utils";
import type { PluginMenuItemMeta } from "@admin/types/branding";

/** Resolve a Lucide icon by name, falling back to the Package icon. */
function iconFor(name?: string): React.ElementType {
  const byName =
    name != null
      ? (Icons as Record<string, React.ElementType>)[name]
      : undefined;
  return byName ?? Package;
}

interface PluginMenuItemsProps {
  isActive: (href?: string) => boolean;
  /**
   * Which sidebar group is rendering. Items are attributed to a group through
   * the plugin deferral chain, so a plugin that placed itself elsewhere has
   * its items listed there rather than under Plugins.
   */
  section: ActiveNavSection;
  /**
   * The panel's search, which these items obey as the panel's other entries
   * do; none filters nothing.
   */
  search?: string;
  /**
   * Draw the items as a menu list of their own, for a panel whose other
   * entries are not in one; nothing at all when there are none, rather than
   * an empty list.
   */
  asMenu?: boolean;
  /**
   * Which sections draw a panel: given, the Plugins panel also lists the
   * items placed in a section that draws none, so each is reachable.
   */
  hasPanel?: (section: ActiveNavSection) => boolean;
}

/**
 * The plugin menu items a panel lists for `section`, as the reader may open
 * them and as `search` filters them: the one list both the drawn items and a
 * panel's count of matches come from, so the two never disagree.
 */
function useVisiblePluginMenuItems(
  section: ActiveNavSection,
  search = "",
  hasPanel?: (section: ActiveNavSection) => boolean
): PluginMenuItemMeta[] {
  const branding = useBranding();
  const { hasPermission } = useCurrentUserPermissions();
  return menuItemsMatching(
    resolveVisibleMenuItems(
      branding?.plugins,
      hasPermission,
      section,
      hasPanel
    ),
    search
  );
}

/**
 * How many plugin menu items the Content panel lists in each of its parts for
 * `search`, so a search that matches only one of them is no empty part.
 */
export function usePluginMatchCounts(search: string): {
  readonly collections: number;
  readonly singles: number;
} {
  const collections = useVisiblePluginMenuItems("collections", search).length;
  const singles = useVisiblePluginMenuItems("singles", search).length;
  return { collections, singles };
}

/**
 * Renders declarative plugin menu items (`contributes.admin.menu`, D20) in the
 * sidebar. Items are RBAC-gated client-side via `useCurrentUserPermissions`
 * (super-admin-aware, closed-until-loaded — the `useCan` semantics, D36) and
 * ordered/nested by `resolveVisibleMenuItems`.
 */
export function PluginMenuItems({
  isActive,
  section,
  search = "",
  asMenu = false,
  hasPanel,
}: PluginMenuItemsProps): React.JSX.Element | null {
  const items = useVisiblePluginMenuItems(section, search, hasPanel);

  if (items.length === 0) return null;

  const drawn = (
    <>
      {items.map(item =>
        item.children && item.children.length > 0 ? (
          <PluginMenuBranch key={item.to} item={item} isActive={isActive} />
        ) : (
          <PluginMenuLeaf key={item.to} item={item} isActive={isActive} />
        )
      )}
    </>
  );
  return asMenu ? <SidebarMenu>{drawn}</SidebarMenu> : drawn;
}

function PluginMenuLeaf({
  item,
  isActive,
}: {
  item: PluginMenuItemMeta;
  isActive: (href?: string) => boolean;
}) {
  const Icon = iconFor(item.icon);
  const active = isActive(item.to);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
        <Link href={item.to}>
          <Icon
            className={cn("shrink-0", !active && "text-muted-foreground")}
          />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function PluginMenuBranch({
  item,
  isActive,
}: {
  item: PluginMenuItemMeta;
  isActive: (href?: string) => boolean;
}) {
  const Icon = iconFor(item.icon);
  const children = item.children ?? [];
  const anyChildActive = children.some(c => isActive(c.to));
  const active = isActive(item.to) || anyChildActive;

  return (
    <Collapsible asChild defaultOpen={anyChildActive}>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip={item.label}
            isActive={active}
            className="group/trigger"
          >
            <Icon
              className={cn("shrink-0", !active && "text-muted-foreground")}
            />
            <span className="flex-1 truncate">{item.label}</span>
            <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-300 ease-out group-data-[state=open]/trigger:rotate-180" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {children.map(child => {
              const ChildIcon = iconFor(child.icon);
              const childActive = isActive(child.to);
              return (
                <SidebarMenuSubItem key={child.to}>
                  <SidebarMenuSubButton asChild isActive={childActive}>
                    <Link href={child.to}>
                      <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>{child.label}</span>
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
}
