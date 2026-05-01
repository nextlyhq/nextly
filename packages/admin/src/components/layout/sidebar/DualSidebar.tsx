"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@revnixhq/ui";
import type React from "react";
import { useState, useEffect, useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { Database } from "@admin/components/icons";
import { ThemeAwareLogo } from "@admin/components/shared/ThemeAwareLogo";
import { Link } from "@admin/components/ui/link";
import { SIDEBAR_NAVIGATION } from "@admin/constants/navigation";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useMediaContext } from "@admin/context/providers/MediaProvider";
import { useCollections, useSingles } from "@admin/hooks/queries";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useRouter } from "@admin/hooks/useRouter";
import { useSidebarNavigation } from "@admin/hooks/useSidebarNavigation";
import {
  filterCollectionItems,
  filterSingleItems,
} from "@admin/lib/permissions/authorization";
import { cn } from "@admin/lib/utils";
import type { ApiCollection } from "@admin/types/entities";

import type { MainMenuCategory, MainMenuItem } from "./sidebar-types";
import { getFilteredMenuItems } from "./sidebar-types";
import { SubSidebarContent } from "./SubSidebarContent";

interface DualSidebarProps {
  isMobile?: boolean;
}

export function DualSidebar({ isMobile }: DualSidebarProps = {}) {
  const { pathname, route } = useRouter();
  const { folderViewMode } = useMediaContext();
  const {
    capabilities,
    permissions,
    hasPermission,
    isLoading: isPermissionsLoading,
    error: permissionsError,
  } = useCurrentUserPermissions();
  const branding = useBranding();
  const showBuilder = branding?.showBuilder ?? true;

  // Runtime-controlled builder visibility from /api/admin-meta
  const baseMenuItems = useMemo(
    () => getFilteredMenuItems(showBuilder),
    [showBuilder]
  );

  // Compute standalone plugins from branding metadata
  const standalonePlugins = useMemo(
    () => (branding?.plugins ?? []).filter(p => p.placement === "standalone"),
    [branding?.plugins]
  );

  const readableResources = useMemo(() => {
    const readable = permissions
      .filter(permission => permission.startsWith("read-"))
      .map(permission => permission.slice("read-".length));
    return new Set(readable);
  }, [permissions]);

  const visibleStandalonePlugins = useMemo(() => {
    return standalonePlugins.filter(plugin => {
      const pluginCollections = plugin.collections ?? [];
      if (pluginCollections.length === 0) {
        return capabilities.canViewSettings;
      }
      return pluginCollections.some(collection =>
        readableResources.has(collection)
      );
    });
  }, [standalonePlugins, readableResources, capabilities.canViewSettings]);

  // Build dynamic menu items for standalone plugins, positioned by `after` + `order`
  const filteredMenuItems = useMemo(() => {
    const ID_TO_ANCHOR: Record<string, string> = {
      dashboard: "dashboard",
      collections: "collections",
      singles: "singles",
      media: "media",
      plugins: "plugins",
      manage: "users",
      settings: "settings",
    };

    if (visibleStandalonePlugins.length === 0) return baseMenuItems;

    const iconMap = Icons as unknown as Record<string, React.ElementType>;

    const byAnchor = new Map<
      string,
      Array<{ item: MainMenuItem; order: number }>
    >();
    for (const sp of visibleStandalonePlugins) {
      const slug = sp.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const iconName = sp.appearance?.icon || "Database";
      const IconComponent = iconMap[iconName] || Database;
      const anchor = sp.after || "plugins";

      const entry = {
        item: {
          id: `standalone-${slug}` as MainMenuCategory,
          label: sp.appearance?.label || sp.name,
          icon: IconComponent,
          href: "#",
        },
        order: sp.order ?? 100,
      };

      if (!byAnchor.has(anchor)) byAnchor.set(anchor, []);
      byAnchor.get(anchor)!.push(entry);
    }

    for (const group of byAnchor.values()) {
      group.sort((a, b) => a.order - b.order);
    }

    const result: MainMenuItem[] = [];
    for (const item of baseMenuItems) {
      result.push(item);
      const anchor = ID_TO_ANCHOR[item.id];
      if (anchor && byAnchor.has(anchor)) {
        for (const { item: standaloneItem } of byAnchor.get(anchor)!) {
          result.push(standaloneItem);
        }
        byAnchor.delete(anchor);
      }
    }

    for (const group of byAnchor.values()) {
      for (const { item: standaloneItem } of group) {
        result.push(standaloneItem);
      }
    }

    return result;
  }, [baseMenuItems, visibleStandalonePlugins]);

  // Fetch data for automatic navigation
  const {
    data: collectionsData,
    isLoading: isCollectionsLoading,
    isError: isCollectionsError,
  } = useCollections({
    pagination: { page: 0, pageSize: 100 },
    sorting: [{ field: "name", direction: "asc" }],
  });

  const {
    data: singlesData,
    isLoading: isSinglesLoading,
    isError: isSinglesError,
  } = useSingles();

  const pluginMetadata = branding?.plugins;

  const permittedCollections = useMemo(() => {
    const allCollections = collectionsData?.data ?? [];
    return filterCollectionItems(allCollections, capabilities);
  }, [collectionsData?.data, capabilities]);

  const permittedSingles = useMemo(() => {
    const allSingles = singlesData?.data ?? [];
    return filterSingleItems(allSingles, capabilities);
  }, [singlesData?.data, capabilities]);

  const getCollectionPlacement = useMemo(() => {
    return (collection: ApiCollection): string | undefined => {
      if (!pluginMetadata) return undefined;
      const meta = pluginMetadata.find(p =>
        (p.collections ?? []).includes(collection.name)
      );
      return meta?.placement ?? meta?.group ?? undefined;
    };
  }, [pluginMetadata]);

  const hasPermissionDataPending =
    isPermissionsLoading || (!!permissionsError && permissions.length === 0);

  const hasCollectionsSection =
    capabilities.canViewCollections &&
    (hasPermissionDataPending ||
      isCollectionsLoading ||
      isCollectionsError ||
      permittedCollections.some(collection => {
        if (collection.admin?.hidden) return false;
        if (collection.admin?.isPlugin) {
          const placement = getCollectionPlacement(collection);
          return placement === "collections" || !placement;
        }
        return true;
      }));

  const hasSinglesSection =
    capabilities.canViewCollections &&
    (hasPermissionDataPending ||
      isSinglesLoading ||
      isSinglesError ||
      permittedSingles.some(single => !single.admin?.hidden));

  const hasPluginsSection =
    capabilities.canViewCollections &&
    (hasPermissionDataPending ||
      isCollectionsLoading ||
      isCollectionsError ||
      permittedCollections.some(collection => {
        if (!collection.admin?.isPlugin || collection.admin?.hidden)
          return false;
        const placement = getCollectionPlacement(collection);
        return !placement || placement === "plugins";
      }) ||
      (branding?.plugins?.length ?? 0) > 0);

  const hasMediaSection = hasPermissionDataPending
    ? true
    : capabilities.canViewMedia;
  const hasUsersSection = hasPermissionDataPending
    ? true
    : capabilities.canViewUsers || capabilities.canViewRoles;
  const canAccessApiKeys =
    hasPermission("read-api-keys") ||
    hasPermission("create-api-keys") ||
    hasPermission("update-api-keys");
  const hasSettingsSection = hasPermissionDataPending
    ? true
    : capabilities.canViewSettings ||
      capabilities.canManageEmailProviders ||
      capabilities.canManageEmailTemplates;
  const hasBuildersSection = showBuilder;

  const visibleMenuItems = useMemo(
    () =>
      filteredMenuItems.filter(item => {
        switch (item.id) {
          case "collections":
            return hasCollectionsSection;
          case "singles":
            return hasSinglesSection;
          case "plugins":
            return hasPluginsSection;
          case "media":
            return hasMediaSection;
          case "manage":
            return hasUsersSection;
          case "settings":
            return hasSettingsSection;
          case "builders":
            return hasBuildersSection;
          default:
            return true;
        }
      }),
    [
      filteredMenuItems,
      hasCollectionsSection,
      hasSinglesSection,
      hasPluginsSection,
      hasMediaSection,
      hasUsersSection,
      hasSettingsSection,
      hasBuildersSection,
    ]
  );

  const activeCategory = useMemo(() => {
    // 0. Check standalone plugin collection routes first
    for (const sp of visibleStandalonePlugins) {
      const slug = sp.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const standaloneId = `standalone-${slug}` as MainMenuCategory;
      const collectionSlugs = sp.collections ?? [];
      if (
        collectionSlugs.some(cs => pathname.includes(`/admin/collection/${cs}`))
      ) {
        return standaloneId;
      }
    }

    // 1. Check if current path is a plugin collection placed in users/settings
    if (collectionsData?.data && pathname.includes("/admin/collection/")) {
      const pluginCollections = collectionsData.data.filter(
        c => c.admin?.isPlugin
      );
      for (const c of pluginCollections) {
        if (!pathname.includes(`/admin/collection/${c.name}`)) continue;
        const placement = getCollectionPlacement(c);
        if (placement === "users") return "manage";
        if (placement === "settings") return "settings";
        if (placement === "collections") return "collections";
        if (placement === "singles") return "singles";
      }
    }

    // 2. Check for plugins — skip plugin collections placed in other sections
    const isPluginPath = (data: typeof collectionsData) => {
      if (!data?.data) return false;
      const pluginCollections = data.data.filter(c => c.admin?.isPlugin);
      return pluginCollections.some(c => {
        if (!pathname.includes(`/admin/collection/${c.name}`)) return false;
        const placement = getCollectionPlacement(c);
        if (placement && placement !== "plugins") return false;
        return true;
      });
    };

    if (
      pathname.includes("/admin/plugins") ||
      pathname.includes("/admin/forms") ||
      isPluginPath(collectionsData)
    ) {
      return "plugins";
    }

    // 3. Standard paths
    if (pathname === ROUTES.DASHBOARD) return "dashboard";

    const fromParam = route?.searchParams?.from;
    if (fromParam === "builders") return "builders";
    if (fromParam === "collections") return "collections";
    if (fromParam === "singles") return "singles";

    if (pathname.includes("/admin/collection/")) return "collections";
    if (
      pathname.includes("/admin/singles/") &&
      !pathname.includes("/admin/singles/builder")
    )
      return "singles";
    if (pathname.includes("/admin/media")) return "media";
    if (
      pathname.includes("/admin/users") ||
      pathname.includes("/admin/security/roles")
    )
      return "manage";
    if (pathname.includes("/admin/settings")) return "settings";
    if (
      pathname.includes("/admin/collections") ||
      pathname.includes("/admin/singles") ||
      pathname.includes("/admin/components")
    ) {
      if (showBuilder) return "builders";

      if (pathname.includes("/admin/collections")) return "collections";
      if (pathname.includes("/admin/singles")) return "singles";
      if (pathname.includes("/admin/components")) return "collections";
    }

    return "dashboard";
  }, [
    pathname,
    collectionsData,
    getCollectionPlacement,
    visibleStandalonePlugins,
    route,
    showBuilder,
  ]);

  const [selectedMain, setSelectedMain] =
    useState<MainMenuCategory>(activeCategory);

  const [collectionSearch, setCollectionSearch] = useState("");
  const [singleSearch, setSingleSearch] = useState("");
  const [pluginSearch, setPluginSearch] = useState("");

  // Sync selectedMain when activeCategory changes (e.g. on navigation)
  useEffect(() => {
    setSelectedMain(activeCategory);
  }, [activeCategory]);

  const { isActive } = useSidebarNavigation(SIDEBAR_NAVIGATION, pathname);

  // Filtering logic for standard collections
  const authorizedCollections = useMemo(() => {
    const visible = (collectionsData?.data ?? []).filter(
      c => !c.admin?.hidden && !c.admin?.isPlugin
    );
    return filterCollectionItems(visible, capabilities);
  }, [collectionsData, capabilities]);

  // Filtering logic for plugins
  const authorizedPlugins = useMemo(() => {
    const visible = (collectionsData?.data ?? []).filter(
      c => !c.admin?.hidden && c.admin?.isPlugin
    );
    return filterCollectionItems(visible, capabilities);
  }, [collectionsData, capabilities]);

  const firstCollectionUrl = useMemo(() => {
    if (authorizedCollections.length > 0) {
      return buildRoute(ROUTES.COLLECTION_ENTRIES, {
        slug: authorizedCollections[0].name,
      });
    }
    return null;
  }, [authorizedCollections]);

  const firstSingleUrl = useMemo(() => {
    if (permittedSingles.length > 0) {
      return buildRoute(ROUTES.SINGLE_EDIT, { slug: permittedSingles[0].slug });
    }
    return null;
  }, [permittedSingles]);

  const firstPluginUrl = useMemo(() => {
    const plugins = branding?.plugins;
    if (plugins && plugins.length > 0) {
      return ROUTES.PLUGINS;
    }
    return null;
  }, [branding?.plugins]);

  // Determine if we should show the second sidebar
  const hasSubSidebar =
    ([
      "collections",
      "singles",
      "plugins",
      "manage",
      "settings",
      ...(showBuilder ? ["builders" as const] : []),
    ].includes(selectedMain) ||
      selectedMain.startsWith("standalone-") ||
      (selectedMain === "media" && folderViewMode === "sidebar")) &&
    !(selectedMain === "media" && folderViewMode === "grid");

  const CATEGORIES_WITH_SUB_SIDEBAR = [
    "collections",
    "singles",
    "media",
    "plugins",
    "manage",
    "settings",
    "builders",
  ];

  const hasSubSidebarCategory = (id: string) =>
    CATEGORIES_WITH_SUB_SIDEBAR.includes(id) || id.startsWith("standalone-");

  const resolveItemHref = (item: MainMenuItem): string => {
    if (item.id === "collections") {
      return firstCollectionUrl || ROUTES.COLLECTIONS + "?from=collections";
    }
    if (item.id === "singles") {
      return firstSingleUrl || ROUTES.SINGLES + "?from=singles";
    }
    if (item.id === "plugins") {
      return firstPluginUrl || "#";
    }
    if (item.id.startsWith("standalone-")) {
      const slug = item.id.replace("standalone-", "");
      const sp = visibleStandalonePlugins.find(
        p =>
          p.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") === slug
      );
      const firstCol = sp?.collections?.[0];
      return firstCol
        ? buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: firstCol })
        : "#";
    }
    return item.href;
  };

  // Resolve collections for the active standalone plugin section
  const pluginCollectionsForSection = useMemo(() => {
    if (!selectedMain.startsWith("standalone-")) return [];
    const slug = selectedMain.replace("standalone-", "");
    const sp = visibleStandalonePlugins.find(
      p =>
        p.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") === slug
    );
    if (!sp) return [];
    const collectionSlugs = new Set(sp.collections ?? []);
    return authorizedPlugins
      .filter(c => collectionSlugs.has(c.name))
      .sort((a, b) => {
        const orderA = a.admin?.order ?? 100;
        const orderB = b.admin?.order ?? 100;
        if (orderA !== orderB) return orderA - orderB;
        return (a.labels?.plural || a.label || a.name).localeCompare(
          b.labels?.plural || b.label || b.name
        );
      });
  }, [selectedMain, visibleStandalonePlugins, authorizedPlugins]);

  // Resolve the label for the active standalone plugin
  const standaloneLabel = useMemo(() => {
    if (!selectedMain.startsWith("standalone-")) return "";
    const slug = selectedMain.replace("standalone-", "");
    const sp = visibleStandalonePlugins.find(
      p =>
        p.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") === slug
    );
    return sp?.appearance?.label || sp?.name || slug;
  }, [selectedMain, visibleStandalonePlugins]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* 1. Icon Sidebar (Main Menu) */}
      <aside
        className={cn(
          "flex flex-col items-center py-4 bg-sidebar border-r border-sidebar-border z-50",
          "w-[72px] shrink-0"
        )}
      >
        {/* Logo */}
        <Link
          href={ROUTES.DASHBOARD}
          className="mb-8 flex items-center justify-center h-10 w-10 group"
        >
          <ThemeAwareLogo
            className="w-6 h-6 object-contain"
            alt={branding.logoText ?? "Logo"}
          />
        </Link>

        {/* Main Icons */}
        <nav className="flex-1 flex flex-col gap-4 w-full px-3">
          {visibleMenuItems.map(item => {
            const Icon = item.icon;
            const isSelected = selectedMain === item.id;
            const href = resolveItemHref(item);
            const stayOnPageMobile = isMobile && hasSubSidebarCategory(item.id);
            const renderAsLink = href !== "#" && !stayOnPageMobile;

            const className = cn(
              "flex items-center justify-center h-11 w-11 rounded-md transition-all duration-200 cursor-pointer relative focus:outline-none",
              isSelected
                ? "bg-primary/5 text-primary"
                : "text-primary/50 hover-unified"
            );

            const iconContent = (
              <>
                <Icon className="h-5 w-5" />
              </>
            );

            return (
              <Tooltip key={item.id} delayDuration={0}>
                <TooltipTrigger asChild>
                  {renderAsLink ? (
                    <Link
                      href={href}
                      onClick={() => setSelectedMain(item.id)}
                      className={className}
                      data-active={isSelected}
                    >
                      {iconContent}
                    </Link>
                  ) : (
                    <button
                      onClick={() => setSelectedMain(item.id)}
                      className={className}
                      data-active={isSelected}
                    >
                      {iconContent}
                    </button>
                  )}
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="bg-slate-900 border-slate-800 text-white"
                >
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </aside>

      {/* 2. Sub Sidebar (Detail Menu) */}
      <aside
        className={cn(
          "flex flex-col bg-background overflow-hidden shrink-0",
          isMobile
            ? "relative flex border-l border-border"
            : "border-r border-border fixed inset-y-0 left-[72px] z-45 lg:static lg:flex lg:border-r", // Absolute on tablet, static on desktop
          hasSubSidebar
            ? "w-64 opacity-100 translate-x-0"
            : "w-0 opacity-0 -translate-x-full pointer-events-none lg:w-0 lg:-translate-x-0",
          !isMobile && "lg:translate-x-0 lg:opacity-100" // Reset for desktop
        )}
      >
        {/* Sub Sidebar Header */}
        <div className="h-16 px-6 flex items-center border-b border-sidebar-border">
          <span className="font-bold text-base tracking-tight capitalize text-foreground">
            {selectedMain.startsWith("standalone-")
              ? standaloneLabel
              : selectedMain === "media"
                ? "Media Library"
                : selectedMain === "builders"
                  ? "Builders"
                  : selectedMain}
          </span>
        </div>

        {/* Sub Sidebar Content */}
        <div className="flex-1 overflow-y-auto">
          <SubSidebarContent
            selectedMain={selectedMain}
            standaloneLabel={standaloneLabel}
            collectionSearch={collectionSearch}
            onCollectionSearchChange={setCollectionSearch}
            singleSearch={singleSearch}
            onSingleSearchChange={setSingleSearch}
            pluginSearch={pluginSearch}
            onPluginSearchChange={setPluginSearch}
            isActive={isActive}
            hasPermission={hasPermission}
            canAccessApiKeys={canAccessApiKeys}
            pluginCollectionsForSection={pluginCollectionsForSection}
            showBuilder={showBuilder}
          />
        </div>
      </aside>
    </div>
  );
}
