"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@revnixhq/ui";
import { ChevronDown } from "lucide-react";
import type React from "react";

import * as Icons from "@admin/components/icons";
import { Loader2, Puzzle } from "@admin/components/icons";
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
import { useComponents } from "@admin/hooks/queries";
import type {
  ApiComponent,
  ComponentMigrationStatus,
} from "@admin/types/entities";

/**
 * Props for the DynamicComponentNav component
 */
interface DynamicComponentNavProps {
  /** Function to check if a route is active */
  isActive: (href?: string) => boolean;
}

/**
 * Migration status indicator component
 *
 * Displays a small colored dot next to Component names to indicate
 * their migration status:
 * - No dot: synced (in sync with database)
 * - Yellow dot: pending (schema changed, migration needed)
 * - Blue dot: generated (migration created but not applied)
 * - Green dot: applied (migration applied, may need sync check)
 * - Red dot: failed (migration failed)
 */
function MigrationIndicator({ status }: { status?: ComponentMigrationStatus }) {
  if (!status || status === "synced") {
    return null;
  }

  const colors: Record<ComponentMigrationStatus, string> = {
    synced: "",
    pending: "bg-yellow-500",
    generated: "bg-primary",
    applied: "bg-green-500",
    failed: "bg-red-500",
  };

  const titles: Record<ComponentMigrationStatus, string> = {
    synced: "In sync",
    pending: "Pending migration",
    generated: "Migration generated",
    applied: "Migration applied",
    failed: "Migration failed",
  };

  return (
    <span
      className={`ml-auto h-2 w-2 rounded-none ${colors[status]}`}
      title={titles[status]}
      aria-label={titles[status]}
    />
  );
}

/**
 * Loading skeleton for Component items
 */
function ComponentSkeleton() {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton disabled className="opacity-50">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">Loading components...</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Groups Components by their admin.category property
 */
function groupComponentsByCategory(
  components: ApiComponent[]
): Map<string, ApiComponent[]> {
  const groups = new Map<string, ApiComponent[]>();

  // Filter out hidden Components
  const visibleComponents = components.filter(
    component => !component.admin?.hidden
  );

  for (const component of visibleComponents) {
    const categoryName = component.admin?.category || "Other";
    const existing = groups.get(categoryName) || [];
    groups.set(categoryName, [...existing, component]);
  }

  return groups;
}

/**
 * Dynamic Component Navigation Component
 *
 * Fetches and displays all Components in the sidebar under the Content section.
 * Each Component links to its builder edit page. Components can be grouped
 * by `admin.category`.
 *
 * ## Features
 *
 * - Fetches Components using TanStack Query (cached, auto-refreshes)
 * - Shows loading skeleton while fetching
 * - Displays migration status indicators
 * - Groups Components by `admin.category` property
 * - Collapsible accordion when multiple groups exist
 * - Links to Component builder edit pages
 * - Supports collapsed sidebar mode (icon only)
 * - Hides Components with `admin.hidden: true`
 *
 * ## Usage
 *
 * ```tsx
 * <DynamicComponentNav isActive={isActive} />
 * ```
 */
export function DynamicComponentNav({ isActive }: DynamicComponentNavProps) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  // Fetch Components with a simple list (first page, large page size for sidebar)
  const { data, isLoading, error } = useComponents(
    {
      pagination: { page: 0, pageSize: 100 },
      sorting: [{ field: "label", direction: "asc" }],
      filters: {},
    },
    {
      // Refetch every 5 minutes to keep sidebar in sync
      staleTime: 5 * 60 * 1000,
    }
  );

  const components = data?.data ?? [];

  // Filter out hidden Components
  const visibleComponents = components.filter(
    component => !component.admin?.hidden
  );

  // Don't render anything if loading in collapsed mode
  if (isLoading) {
    if (isCollapsed) return null;
    return <ComponentSkeleton />;
  }

  // Don't show error in sidebar, just hide section if no Components
  if (error || visibleComponents.length === 0) {
    return null;
  }

  // Build the edit URL for a Component (links to builder edit page)
  const getComponentUrl = (component: ApiComponent) => {
    return buildRoute(ROUTES.COMPONENTS_BUILDER_EDIT, { slug: component.slug });
  };

  // Check if any Component route is active
  const isAnyComponentActive = visibleComponents.some(component =>
    isActive(getComponentUrl(component))
  );

  // Group Components by admin.category
  const groupedComponents = groupComponentsByCategory(visibleComponents);
  const hasMultipleGroups = groupedComponents.size > 1;

  // Render as collapsible accordion when expanded
  if (!isCollapsed) {
    // If only one group or all ungrouped, render as flat list
    if (!hasMultipleGroups) {
      return (
        <Collapsible asChild defaultOpen={isAnyComponentActive}>
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton
                tooltip="Components"
                isActive={isAnyComponentActive}
                className="group/trigger"
              >
                <Puzzle className="text-primary" />
                <span className="flex-1">Components</span>
                <ChevronDown className="ml-auto transition-transform duration-300 ease-out group-data-[state=open]/trigger:rotate-180" />
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarMenuSub>
                {visibleComponents.map(component => {
                  const href = getComponentUrl(component);
                  const isSubActive = isActive(href);

                  return (
                    <SidebarMenuSubItem key={component.id}>
                      <SidebarMenuSubButton
                        asChild
                        isActive={isSubActive}
                        className={
                          isSubActive
                            ? "bg-accent/20 text-accent font-medium"
                            : ""
                        }
                      >
                        <Link href={href} className="flex items-center gap-2">
                          {(() => {
                            const iconName = component.admin?.icon || "Puzzle";
                            const IconComponent =
                              (
                                Icons as Record<
                                  string,
                                  React.ComponentType<{ className?: string }>
                                >
                              )[iconName] || Icons.Puzzle;
                            return (
                              <IconComponent className="h-4 w-4 shrink-0" />
                            );
                          })()}
                          <span className="truncate">{component.label}</span>
                          <MigrationIndicator
                            status={component.migrationStatus}
                          />
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

    // Multiple groups - render nested collapsibles
    return (
      <Collapsible asChild defaultOpen={isAnyComponentActive}>
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              tooltip="Components"
              isActive={isAnyComponentActive}
              className="group/trigger"
            >
              <Puzzle className="text-primary" />
              <span className="flex-1">Components</span>
              <ChevronDown className="ml-auto transition-transform duration-300 ease-out group-data-[state=open]/trigger:rotate-180" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {Array.from(groupedComponents.entries()).map(
                ([categoryName, categoryComponents]) => {
                  const isCategoryActive = categoryComponents.some(component =>
                    isActive(getComponentUrl(component))
                  );

                  return (
                    <Collapsible
                      key={categoryName}
                      asChild
                      defaultOpen={isCategoryActive}
                    >
                      <SidebarMenuSubItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuSubButton
                            className="group/subtrigger"
                            isActive={isCategoryActive}
                          >
                            <Puzzle className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="flex-1 truncate">
                              {categoryName}
                            </span>
                            <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform duration-300 ease-out group-data-[state=open]/subtrigger:rotate-180" />
                          </SidebarMenuSubButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="ml-4  border-l border-primary/5 border-sidebar-border/30 pl-2">
                            {categoryComponents.map(component => {
                              const href = getComponentUrl(component);
                              const isSubActive = isActive(href);

                              return (
                                <Link
                                  key={component.id}
                                  href={href}
                                  className={`flex items-center gap-2 py-1.5 px-2 text-sm rounded-none transition-colors ${
                                    isSubActive
                                      ? "bg-accent/20 text-accent font-medium"
                                      : "text-muted-foreground hover:text-foreground hover:bg-accent/10"
                                  }`}
                                >
                                  {(() => {
                                    const iconName =
                                      component.admin?.icon || "Puzzle";
                                    const IconComponent =
                                      (
                                        Icons as Record<
                                          string,
                                          React.ComponentType<{
                                            className?: string;
                                          }>
                                        >
                                      )[iconName] || Icons.Puzzle;
                                    return (
                                      <IconComponent className="h-3.5 w-3.5 shrink-0" />
                                    );
                                  })()}
                                  <span className="truncate">
                                    {component.label}
                                  </span>
                                  <MigrationIndicator
                                    status={component.migrationStatus}
                                  />
                                </Link>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </SidebarMenuSubItem>
                    </Collapsible>
                  );
                }
              )}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  }

  // Collapsed mode: Just show a single icon button
  // Links to the Components list page
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip="Components"
        isActive={isAnyComponentActive}
      >
        <Link href={ROUTES.COMPONENTS}>
          <Puzzle className="text-primary" />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
