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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@admin/components/layout/sidebar";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { resolveVisibleMenuItems } from "@admin/lib/plugins/menu";
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
}

/**
 * Renders declarative plugin menu items (`contributes.admin.menu`, D20) in the
 * sidebar. Items are RBAC-gated client-side via `useCurrentUserPermissions`
 * (super-admin-aware, closed-until-loaded — the `useCan` semantics, D36) and
 * ordered/nested by `resolveVisibleMenuItems`.
 */
export function PluginMenuItems({ isActive }: PluginMenuItemsProps) {
  const branding = useBranding();
  const { hasPermission } = useCurrentUserPermissions();
  const items = resolveVisibleMenuItems(branding?.plugins, hasPermission);

  if (items.length === 0) return null;

  return (
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
        {/* A plugin menu item is an arbitrary URL by contract — it may point at
            a plugin HTTP route (e.g. the api-docs reference) rather than an
            admin page. Client-side routing such a URL resolves against the page
            tree and lands on the admin 404, so plugin items navigate with a
            full page load. */}
        <a href={item.to}>
          <Icon
            className={cn("shrink-0", !active && "text-muted-foreground")}
          />
          <span>{item.label}</span>
        </a>
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
                    {/* Same full-load contract as the leaf: a child may target a
                        plugin HTTP route, which is not an admin page. */}
                    <a href={child.to}>
                      <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>{child.label}</span>
                    </a>
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
