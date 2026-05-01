import { DynamicCollectionNav } from "@admin/components/features/dashboard/DynamicCollectionNav";
import { DynamicPluginNav } from "@admin/components/features/dashboard/DynamicPluginNav";
import { DynamicPluginSectionItems } from "@admin/components/features/dashboard/DynamicPluginSectionItems";
import { DynamicSingleNav } from "@admin/components/features/dashboard/DynamicSingleNav";
import {
  Layers,
  Settings,
  Puzzle,
  Users,
  ShieldAlert,
  Mail,
  Key,
  List,
  FileText,
  Database,
  Image,
} from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import type { ApiCollection } from "@admin/types/entities";

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
          <p className="text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40 px-3 mb-2">
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
          <p className="text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40 px-3 mb-2">
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
          <p className="text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40 px-3 mb-2">
            Install Plugins
          </p>
          <SidebarMenu>
            <DynamicPluginNav isActive={isActive} search={pluginSearch} />
          </SidebarMenu>
        </div>
      </div>
    );
  }

  if (selectedMain.startsWith("standalone-")) {
    return (
      <div className="space-y-6 px-4 py-6">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40 px-3 mb-2">
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
                      <IconComponent className="h-4 w-4 mr-2" />
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

  if (selectedMain === "manage") {
    return (
      <div className="space-y-6 px-4 py-6">
        <div className="space-y-1">
          {(hasPermission("read-users") ||
            hasPermission("manage-settings") ||
            hasPermission("read-roles")) && (
            <p className="text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40 px-3 mb-2">
              User Management
            </p>
          )}
          <SidebarMenu>
            {hasPermission("read-users") && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={
                    isActive(ROUTES.USERS) && !isActive(ROUTES.USERS_FIELDS)
                  }
                  className="justify-start px-3"
                >
                  <Link href={ROUTES.USERS}>
                    <Users className="h-4 w-4 mr-2" />
                    <span>Users</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {hasPermission("manage-settings") && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(ROUTES.USERS_FIELDS)}
                  className="justify-start px-3"
                >
                  <Link href={ROUTES.USERS_FIELDS}>
                    <List className="h-4 w-4 mr-2" />
                    <span>User Fields</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {hasPermission("read-roles") && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(ROUTES.SECURITY_ROLES)}
                  className="justify-start px-3"
                >
                  <Link href={ROUTES.SECURITY_ROLES}>
                    <ShieldAlert className="h-4 w-4 mr-2" />
                    <span>Roles</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </div>
        <DynamicPluginSectionItems placement="users" isActive={isActive} />
      </div>
    );
  }

  if (selectedMain === "settings") {
    return (
      <div className="space-y-8 px-4 py-6">
        {/* System Settings Group */}
        <div className="space-y-1">
          {(hasPermission("manage-settings") || canAccessApiKeys) && (
            <p className="text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40 px-3 mb-2">
              System Settings
            </p>
          )}
          <SidebarMenu>
            {hasPermission("manage-settings") && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(ROUTES.SETTINGS, true)}
                  className="justify-start px-3"
                >
                  <Link href={ROUTES.SETTINGS}>
                    <Settings className="h-4 w-4 mr-2" />
                    <span>General</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {canAccessApiKeys && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(ROUTES.SETTINGS_API_KEYS)}
                  className="justify-start px-3"
                >
                  <Link href={ROUTES.SETTINGS_API_KEYS}>
                    <Key className="h-4 w-4 mr-2" />
                    <span>API Keys</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {hasPermission("manage-settings") && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(ROUTES.SETTINGS_IMAGE_SIZES)}
                  className="justify-start px-3"
                >
                  <Link href={ROUTES.SETTINGS_IMAGE_SIZES}>
                    <Image className="h-4 w-4 mr-2" />
                    <span>Image Sizes</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </div>

        {/* Email Configuration Group */}
        <div className="space-y-1">
          {(hasPermission("manage-email-providers") ||
            hasPermission("manage-email-templates")) && (
            <p className="text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40 px-3 mb-2">
              Email Configuration
            </p>
          )}
          <SidebarMenu>
            {hasPermission("manage-email-providers") && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(ROUTES.SETTINGS_EMAIL_PROVIDERS)}
                  className="justify-start px-3"
                >
                  <Link href={ROUTES.SETTINGS_EMAIL_PROVIDERS}>
                    <Mail className="h-4 w-4 mr-2" />
                    <span>Providers</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {hasPermission("manage-email-templates") && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(ROUTES.SETTINGS_EMAIL_TEMPLATES)}
                  className="justify-start px-3"
                >
                  <Link href={ROUTES.SETTINGS_EMAIL_TEMPLATES}>
                    <FileText className="h-4 w-4 mr-2" />
                    <span>Templates</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </div>
        <DynamicPluginSectionItems placement="settings" isActive={isActive} />
      </div>
    );
  }

  if (selectedMain === "builders") {
    return (
      <div className="space-y-6 px-4 py-6">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40 px-3 mb-2">
            Content Builders
          </p>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive(ROUTES.COLLECTIONS)}
                className="justify-start px-3"
              >
                <Link href={ROUTES.COLLECTIONS}>
                  <Layers className="h-4 w-4 mr-2" />
                  <span>Collections</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive(ROUTES.SINGLES)}
                className="justify-start px-3"
              >
                <Link href={ROUTES.SINGLES}>
                  <FileText className="h-4 w-4 mr-2" />
                  <span>Singles</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive(ROUTES.COMPONENTS)}
                className="justify-start px-3"
              >
                <Link href={ROUTES.COMPONENTS}>
                  <Puzzle className="h-4 w-4 mr-2" />
                  <span>Components</span>
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
