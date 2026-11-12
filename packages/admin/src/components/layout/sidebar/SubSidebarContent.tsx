import type { JSX } from "react";

import { DynamicPluginNav } from "@admin/components/features/dashboard/DynamicPluginNav";
import { DynamicPluginSectionItems } from "@admin/components/features/dashboard/DynamicPluginSectionItems";
import {
  PluginMenuGroups,
  PluginMenuItems,
} from "@admin/components/features/dashboard/PluginMenuItems";
import * as Icons from "@admin/components/icons";
import { Layers, Puzzle, FileText } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { contentIcon } from "@admin/lib/content-icons";
import { CHANGE_SETTINGS } from "@admin/lib/permissions/system-policy";
import { cn } from "@admin/lib/utils";
import type { ApiCollection } from "@admin/types/entities";

import { ContentPanel } from "./ContentPanel";
import { isContentSection } from "./lib/content-rail";
import {
  isSettingsNavItemActive,
  visibleSettingsNav,
} from "./lib/settings-nav";
import { MediaSidebarContent } from "./MediaSidebarContent";
import type { MainMenuCategory } from "./sidebar-types";
import { SidebarSearch } from "./SidebarSearch";
import { StandalonePanelItems } from "./StandalonePanelItems";

import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "./index";

interface SubSidebarContentProps {
  selectedMain: MainMenuCategory;
  standaloneLabel: string;
  // Search state: one for both content kinds
  contentSearch: string;
  onContentSearchChange: (value: string) => void;
  /** Whether the reader has collections to list. */
  hasCollectionsSection: boolean;
  /** Whether the reader has Singles to list. */
  hasSinglesSection: boolean;
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
  /**
   * Whether a section draws a panel this reader can open; the plugin menu
   * items of one that does not are listed under Plugins.
   */
  hasPanel: (section: string) => boolean;
}

export function SubSidebarContent({
  selectedMain,
  standaloneLabel,
  contentSearch,
  onContentSearchChange,
  hasCollectionsSection,
  hasSinglesSection,
  pluginSearch,
  onPluginSearchChange,
  isActive,
  hasPermission,
  canAccessApiKeys,
  canAccessWebhooks,
  pluginCollectionsForSection,
  hasPanel,
}: SubSidebarContentProps): JSX.Element | null {
  if (selectedMain === "media") {
    return (
      <>
        <MediaSidebarContent />
        {/* The plugin menu items placed in Media, below its folders. */}
        <div className="px-4 pb-6">
          <PluginMenuItems isActive={isActive} section="media" asMenu />
        </div>
      </>
    );
  }

  if (isContentSection(selectedMain)) {
    return (
      <ContentPanel
        search={contentSearch}
        onSearchChange={onContentSearchChange}
        hasCollections={hasCollectionsSection}
        hasSingles={hasSinglesSection}
        isActive={isActive}
      />
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
          {/* Names what the panel contains: the installed-plugins overview and
              navigation into each plugin's collections. Nothing here installs
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
            {CHANGE_SETTINGS.some(hasPermission) && (
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
          </SidebarMenu>
        </div>
        {/* Each plugin's own pages (`contributes.admin.menu`), under its
            name, apart from managing plugins above: a plugin with pages of
            its own, such as a library, is reached here. */}
        <PluginMenuGroups
          isActive={isActive}
          section="plugins"
          search={pluginSearch}
          hasPanel={hasPanel}
        />
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
              // The icon every panel draws for a collection: the one it
              // names, else the list.
              const IconComponent = contentIcon(
                "collection",
                collection.admin?.icon
              );

              return (
                <SidebarMenuItem key={collection.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActiveItem}
                    className="justify-start px-3"
                  >
                    <Link href={href}>
                      <IconComponent
                        aria-hidden="true"
                        className={cn(
                          "h-4 w-4",
                          !isActiveItem && "text-muted-foreground"
                        )}
                      />
                      <span>{displayName}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
          {/* And the menu items the plugin places in its own section, under
              the groups and with the numbers it declares, if any. */}
          <StandalonePanelItems isActive={isActive} section={selectedMain} />
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
                const active = isSettingsNavItemActive(item, isActive);

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
        {/* Plugin menu items placed in Settings (or in Users, which shows
            here), in a list of their own. */}
        <PluginMenuItems isActive={isActive} section="settings" asMenu />
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
            {/* The plugin menu items placed in the builders. */}
            <PluginMenuItems isActive={isActive} section="builders" />
          </SidebarMenu>
        </div>
      </div>
    );
  }

  return null;
}
