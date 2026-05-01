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
  Input,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@revnixhq/ui";
import React from "react";

import { DynamicPluginSectionItems } from "@admin/components/features/dashboard/DynamicPluginSectionItems";
import { ChevronDown, Search } from "@admin/components/icons";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@admin/components/layout/sidebar";
import { Link } from "@admin/components/ui/link";
import type { NavigationItem } from "@admin/constants/navigation";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { filterNavigationItems } from "@admin/lib/permissions/authorization";
import { cn } from "@admin/lib/utils";

import { DynamicCollectionNav } from "./DynamicCollectionNav";
import { DynamicCustomGroupNav } from "./DynamicCustomGroupNav";
import { DynamicPluginNav } from "./DynamicPluginNav";
import { DynamicSingleNav } from "./DynamicSingleNav";

interface SidebarNavigationProps {
  items: NavigationItem[];
  isActive: (href?: string) => boolean;
  hideLabels?: string[];
}

export function SidebarNavigationItem({
  item,
  isActive,
  isCollapsed,
  active,
}: {
  item: NavigationItem;
  isActive: (href?: string) => boolean;
  isCollapsed: boolean;
  active?: boolean;
}) {
  const isItemActive = active !== undefined ? active : isActive(item.href);
  const Icon = item.icon;
  const hasSubItems = item.subItems && item.subItems.length > 0;

  // State for hover behavior (simulate HoverCard for Dropdown)
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

  // Common styling for active/inactive states
  const buttonClass = cn(
    "transition-none",
    "group-data-[collapsible=icon]:!p-2"
  );

  // Icon inherits color and size from SidebarMenuButton variants
  const iconClass = cn(
    "shrink-0",
    !isItemActive && "text-muted-foreground group-hover-unified"
  );

  // 1. Nested Item - Collapsed Mode (Dropdown / Flyout)
  if (hasSubItems && isCollapsed) {
    return (
      <SidebarMenuItem
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton isActive={isItemActive} className={buttonClass}>
              <Icon className={iconClass} />
              <span className="sr-only">{item.title}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            className="w-56 ml-2 admin-dropdown-content shadow-xl shadow-black/5 border-border/50"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <DropdownMenuLabel>{item.title}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {item.subItems?.map(sub => {
              const isSubActive = isActive(sub.href);
              return (
                <DropdownMenuItem key={sub.href} asChild>
                  <Link
                    href={sub.href}
                    data-active={isSubActive ? "true" : undefined}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 transition-none admin-dropdown-item", // Consistent styling
                      isSubActive && "!font-bold" // Keep active item bold
                    )}
                  >
                    {(() => {
                      const SubIcon = sub.icon;
                      return SubIcon ? <SubIcon className="h-4 w-4" /> : null;
                    })()}

                    <span>{sub.title}</span>
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  // 2. Nested Item - Expanded Mode (Collapsible)
  if (hasSubItems) {
    return (
      <Collapsible
        asChild
        defaultOpen={isItemActive}
        className="group/collapsible"
      >
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              isActive={isItemActive}
              className={cn(buttonClass, "w-full justify-start")} // Override center
            >
              <Icon className={iconClass} />
              <span className="flex-1">{item.title}</span>
              <ChevronDown className="ml-auto group-data-[state=open]/collapsible:rotate-180" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {item.subItems?.map(sub => {
                const isSubActive = isActive(sub.href);
                return (
                  <SidebarMenuSubItem key={sub.href}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={isSubActive}
                      className={cn(
                        "transition-none", // No transition
                        isSubActive
                          ? "!bg-primary/5 !text-primary font-medium hover:!bg-primary/5 hover:!text-primary"
                          : "hover-unified"
                      )}
                    >
                      <Link href={sub.href}>
                        <span>{sub.title}</span>
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

  // 3. Single Item
  // Explicitly wrapped in Tooltip to ensure visibility when collapsed
  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuButton
            asChild
            isActive={isItemActive}
            className={cn(buttonClass, !isCollapsed && "justify-start")}
          >
            <Link href={item.href ?? ""}>
              <Icon className={iconClass} />
              {!isCollapsed && <span>{item.title}</span>}
            </Link>
          </SidebarMenuButton>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          hidden={!isCollapsed}
          className="bg-black text-white"
          style={{ backgroundColor: "black", color: "white" }}
        >
          {item.title}
        </TooltipContent>
      </Tooltip>
    </SidebarMenuItem>
  );
}

/**
 * Sidebar Navigation Component
 *
 * Professional sidebar design with:
 * - Section group labels (uppercase, 11px)
 * - Horizontal separators between sections
 * - Traditional nested navigation
 * - Dynamic collections in Content section
 * - Settings section with Collection Builder
 * - All features visible and organized
 * - Clean and professional aesthetic
 */
export function SidebarNavigation({
  items,
  isActive,
  hideLabels = [],
}: SidebarNavigationProps) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { capabilities } = useCurrentUserPermissions();
  const branding = useBranding();
  const showBuilder = branding?.showBuilder ?? true;
  const [search, setSearch] = React.useState("");

  const showCollectionsSection = capabilities.canViewCollections;
  const showSinglesSection = capabilities.canViewCollections;
  const showPluginsSection = capabilities.canViewCollections;
  const showSettingsSection =
    capabilities.canViewSettings ||
    capabilities.canManageEmailProviders ||
    capabilities.canManageEmailTemplates;
  const showBuilderSection = showBuilder;

  // Filter items based on user permissions before grouping
  const authorizedItems = filterNavigationItems(items, capabilities);

  // Filter items based on search query
  const filteredItems = React.useMemo(() => {
    if (!search) return authorizedItems;
    const lowerSearch = search.toLowerCase();
    return authorizedItems.filter(item => {
      const titleMatch = item.title.toLowerCase().includes(lowerSearch);
      const subItemsMatch = item.subItems?.some(sub =>
        sub.title.toLowerCase().includes(lowerSearch)
      );
      return titleMatch || subItemsMatch;
    });
  }, [authorizedItems, search]);

  // Group items by category (using filtered items)
  const mainNavItems = filteredItems.filter(item => item.category === "main");
  const mediaItems = filteredItems.filter(item => item.category === "media");
  const userItems = filteredItems.filter(item => item.category === "users");
  const settingsItems = filteredItems.filter(
    item => item.category === "settings"
  );
  const builderItems = filteredItems.filter(
    item => item.category === "builder"
  );

  // Sub-group settings items
  const systemSettings = settingsItems.filter(
    item => item.subGroup === "system"
  );
  const emailSettings = settingsItems.filter(item => item.subGroup === "email");

  const RenderSection = ({
    label,
    items,
  }: {
    label: string;
    items: NavigationItem[];
  }) => {
    if (items.length === 0) return null;
    return (
      <>
        <SidebarGroup>
          {!isCollapsed && !hideLabels.includes(label) && (
            <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
              {label}
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map(item => (
                <SidebarNavigationItem
                  key={item.href ?? item.title}
                  item={item}
                  isActive={isActive}
                  isCollapsed={isCollapsed}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {!isCollapsed && <Separator className="my-1 bg-sidebar-border/30" />}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-0">
      {/* Search Bar - only when not collapsed */}
      {!isCollapsed && (
        <div className="px-3 pb-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-white/50 dark:bg-slate-900/50 border-slate-200/60 dark:border-slate-800/60 text-xs h-9"
            />
          </div>
        </div>
      )}

      {/* 1. Dashboard */}
      <RenderSection label="Main" items={mainNavItems} />

      {/* 2. Collections + Custom groups */}
      {showCollectionsSection && (
        <SidebarGroup>
          {!isCollapsed && (
            <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
              Collections
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              <DynamicCollectionNav isActive={isActive} search={search} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {/* 3. Singles */}
      {showSinglesSection && (
        <SidebarGroup>
          {!isCollapsed && (
            <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
              Singles
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              <DynamicSingleNav isActive={isActive} search={search} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {/* 4. Custom groups (user-created) */}
      {showCollectionsSection && (
        <DynamicCustomGroupNav isActive={isActive} search={search} />
      )}

      {/* 5. Separator */}
      {(showCollectionsSection || showSinglesSection) && !isCollapsed && (
        <Separator className="my-1 bg-sidebar-border/30" />
      )}

      {/* 6. Media Library (NIS) */}
      {mediaItems.length > 0 && (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mediaItems.map(item => (
                <SidebarNavigationItem
                  key={item.href ?? item.title}
                  item={item}
                  isActive={isActive}
                  isCollapsed={isCollapsed}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {/* 6. Separator */}
      {!isCollapsed && <Separator className="my-1 bg-sidebar-border/30" />}

      {/* 7. Users */}
      <RenderSection label="Users" items={userItems} />
      <DynamicPluginSectionItems placement="users" isActive={isActive} />

      {/* 8. Separator */}
      {!isCollapsed && <Separator className="my-1 bg-sidebar-border/30" />}

      {/* 9. Plugins */}
      {showPluginsSection && (
        <SidebarGroup>
          {!isCollapsed && (
            <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
              Plugins
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              <DynamicPluginNav isActive={isActive} search={search} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {/* 10. Separator */}
      {showPluginsSection && !isCollapsed && (
        <Separator className="my-1 bg-sidebar-border/30" />
      )}

      {/* 11. Settings with sub-groups */}
      {showSettingsSection && (
        <SidebarGroup>
          {!isCollapsed && (
            <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
              Settings
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {systemSettings.length > 0 && (
                <>
                  {!isCollapsed && (
                    <li className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                      System Settings
                    </li>
                  )}
                  {systemSettings.map(item => (
                    <SidebarNavigationItem
                      key={item.href ?? item.title}
                      item={item}
                      isActive={isActive}
                      isCollapsed={isCollapsed}
                    />
                  ))}
                </>
              )}
              {emailSettings.length > 0 && (
                <>
                  {!isCollapsed && (
                    <li className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                      Email Configuration
                    </li>
                  )}
                  {emailSettings.map(item => (
                    <SidebarNavigationItem
                      key={item.href ?? item.title}
                      item={item}
                      isActive={isActive}
                      isCollapsed={isCollapsed}
                    />
                  ))}
                </>
              )}
              <DynamicPluginSectionItems
                placement="settings"
                isActive={isActive}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {/* 12. Separator */}
      {showSettingsSection && !isCollapsed && (
        <Separator className="my-1 bg-sidebar-border/30" />
      )}

      {/* 13. Builder — runtime-controlled by host config */}
      {showBuilderSection && (
        <RenderSection label="Builder" items={builderItems} />
      )}
    </div>
  );
}
