import { DynamicCollectionNav } from "@admin/components/features/dashboard/DynamicCollectionNav";
import { DynamicPluginNav } from "@admin/components/features/dashboard/DynamicPluginNav";
import { DynamicPluginSectionItems } from "@admin/components/features/dashboard/DynamicPluginSectionItems";
import { DynamicSingleNav } from "@admin/components/features/dashboard/DynamicSingleNav";
import { PluginMenuItems } from "@admin/components/features/dashboard/PluginMenuItems";
import * as Icons from "@admin/components/icons";
import { Layers, Puzzle, FileText, Database } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import type { ApiCollection } from "@admin/types/entities";

import { visibleSettingsNav } from "./lib/settings-nav";
import { MediaSidebarContent } from "./MediaSidebarContent";
import type { MainMenuCategory } from "./sidebar-types";
import { SidebarSearch } from "./SidebarSearch";

import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "./index";

interface SubSidebarContentProps {
  selectedMain: MainMenuCategory;
  standaloneLabel: string;
  // Search state
  collectionSearch: string;
  onCollectionSearchChange: (value: string) => void;
  singleSearch: string;
  onSingleSearchChange: (value: string) => void;
  pluginSearch: string;
  onPluginSearchChange: (value: string) => void;
  // Navigation — typed with optional href to satisfy child component contracts
  isActive: (href?: string, exact?: boolean) => boolean;
  hasPermission: (permission: string) => boolean;
  canAccessApiKeys: boolean;
  canAccessWebhooks: boolean;
  // Plugin collections for standalone sections
  pluginCollectionsForSection: ApiCollection[];
  // Branding
  showBuilder: boolean;
}

export function SubSidebarContent({
  selectedMain,
  standaloneLabel,
  collectionSearch,
  onCollectionSearchChange,
  singleSearch,
  onSingleSearchChange,
  pluginSearch,
  onPluginSearchChange,
  isActive,
  hasPermission,
  canAccessApiKeys,
  canAccessWebhooks,
  pluginCollectionsForSection,
}: SubSidebarContentProps) {
  if (selectedMain === "media") {
    return <MediaSidebarContent />;
  }

  if (selectedMain === "collections") {
    return (
      <div className="space-y-6 px-4 py-6">
        <SidebarSearch
          placeholder="Search collection types"
          value={collectionSearch}
          onChange={onCollectionSearchChange}
        />
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground px-3 mb-2">
            Collections
          </p>
          <SidebarMenu>
            <DynamicCollectionNav
              isActive={isActive}
              search={collectionSearch}
            />
          </SidebarMenu>
        </div>
      </div>
    );
  }

  if (selectedMain === "singles") {
    return (
      <div className="space-y-6 px-4 py-6">
        <SidebarSearch
          placeholder="Search singles"
          value={singleSearch}
          onChange={onSingleSearchChange}
        />
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground px-3 mb-2">
            Singles
          </p>
          <SidebarMenu>
            <DynamicSingleNav isActive={isActive} search={singleSearch} />
          </SidebarMenu>
        </div>
      </div>
    );
  }

  if (selectedMain === "plugins") {
    return (
      <div className="space-y-6 px-4 py-6">
        <SidebarSearch
          placeholder="Search plugins"
          value={pluginSearch}
          onChange={onPluginSearchChange}
        />
        <div className="space-y-1">
          {/* Names what the panel contains: the installed-plugins overview,
              navigation into each plugin's collections, and any declarative
              menu items plugins contribute via `contributes.admin.menu` (D20) —
              e.g. the api-docs plugin's reference link. Nothing here installs
              a plugin, which happens through the Nextly config. */}
          <p className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground px-3 mb-2">
            Plugins
          </p>
          <SidebarMenu>
            <DynamicPluginNav isActive={isActive} search={pluginSearch} />
            {/* Gated on the permission `PLUGIN_BROWSE` itself requires. The
                panel stays open to a user who can only read a plugin-owned
                collection, so without this they would be offered a destination
                that redirects them the moment they choose it.

                Below the installed plugins, not above: this panel is for
                getting to what the project already has, and the directory is
                the occasional trip. Not filtered by `pluginSearch` either —
                that box searches installed plugins, and an entry that ignores
                it while sitting among entries that obey it reads as a bug. */}
            {hasPermission("manage-settings") && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(ROUTES.PLUGIN_BROWSE)}
                >
                  <Link href={ROUTES.PLUGIN_BROWSE}>
                    <Icons.Search className="h-4 w-4 shrink-0" />
                    <span>Browse plugins</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <PluginMenuItems isActive={isActive} />
          </SidebarMenu>
        </div>
      </div>
    );
  }

  if (selectedMain.startsWith("standalone-")) {
    return (
      <div className="space-y-6 px-4 py-6">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground px-3 mb-2">
            {standaloneLabel}
          </p>
          <SidebarMenu>
            {pluginCollectionsForSection.map(collection => {
              const href = buildRoute(ROUTES.COLLECTION_ENTRIES, {
                slug: collection.name,
              });
              const isActiveItem = isActive(href);
              const displayName =
                collection.labels?.plural ||
                collection.label ||
                collection.name;
              const iconMap = Icons as unknown as Record<
                string,
                React.ElementType
              >;
              const iconName = collection.admin?.icon || "Database";
              const IconComponent = iconMap[iconName] || Database;

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
      </div>
    );
  }

  if (selectedMain === "settings") {
    const groups = visibleSettingsNav({
      hasPermission,
      canAccessApiKeys,
      canAccessWebhooks,
    });

    return (
      <div className="space-y-8 px-4 py-6">
        {groups.map(group => (
          <div key={group.id} className="space-y-1">
            {group.items.length > 0 && (
              <p className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground px-3 mb-2">
                {group.label}
              </p>
            )}
            <SidebarMenu>
              {group.items.map(item => {
                const ItemIcon = item.icon;
                const active =
                  isActive(item.href, item.exact) &&
                  !(item.excludedBy ?? []).some(href => isActive(href));

                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      className="justify-start px-3"
                    >
                      <Link href={item.href}>
                        <ItemIcon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
            {group.pluginPlacement && (
              <DynamicPluginSectionItems
                placement={group.pluginPlacement}
                isActive={isActive}
              />
            )}
          </div>
        ))}
        <DynamicPluginSectionItems placement="settings" isActive={isActive} />
      </div>
    );
  }

  if (selectedMain === "builders") {
    return (
      <div className="space-y-6 px-4 py-6">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground px-3 mb-2">
            Content Builders
          </p>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive(ROUTES.BUILDER_COLLECTIONS)}
                className="justify-start px-3"
              >
                <Link href={ROUTES.BUILDER_COLLECTIONS}>
                  <Layers className="h-4 w-4" />
                  <span>Collections</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive(ROUTES.BUILDER_SINGLES)}
                className="justify-start px-3"
              >
                <Link href={ROUTES.BUILDER_SINGLES}>
                  <FileText className="h-4 w-4" />
                  <span>Singles</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive(ROUTES.BUILDER_FIELD_GROUPS)}
                className="justify-start px-3"
              >
                <Link href={ROUTES.BUILDER_FIELD_GROUPS}>
                  <Puzzle className="h-4 w-4" />
                  <span>Field Groups</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </div>
    );
  }

  return null;
}
