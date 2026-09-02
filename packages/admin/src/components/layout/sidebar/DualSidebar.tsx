"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@nextlyhq/ui";
import type React from "react";
import { useState, useEffect, useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { Database } from "@admin/components/icons";
import { ThemeAwareLogo } from "@admin/components/shared/ThemeAwareLogo";
import { Link } from "@admin/components/ui/link";
import { SIDEBAR_NAVIGATION } from "@admin/constants/navigation";
import { ROUTES } from "@admin/constants/routes";
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
import { resolveCollectionPlacement } from "@admin/lib/plugins/collection-placement";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import { resolvePluginIcon } from "@admin/lib/plugins/resolve-plugin-icon";
import { cn } from "@admin/lib/utils";
import type { ApiCollection } from "@admin/types/entities";

import { useSuppressedChrome } from "../ChromeSuppression";

import { hasCollectionsSection as hasCollectionsSectionHelper } from "./lib/has-collections-section";
import {
  hasPluginsSection,
  hasVisiblePluginCollection,
} from "./lib/has-plugins-section";
import { isSubSidebarCategory } from "./lib/has-sub-sidebar";
import { resolveItemHref as resolveItemHrefHelper } from "./lib/resolve-item-href";
import { resolveActiveSection } from "./lib/resolve-section";
import { resolveSettingsLanding } from "./lib/resolve-settings-landing";
import { resolveStandaloneLabel } from "./lib/resolve-standalone-label";
import type { MainMenuCategory, MainMenuItem } from "./sidebar-types";
import { getFilteredMenuItems } from "./sidebar-types";
import { SubSidebarPanel } from "./SubSidebarPanel";

interface DualSidebarProps {
  isMobile?: boolean;
}

export function DualSidebar({ isMobile }: DualSidebarProps = {}) {
  const { pathname, route, isHydrated } = useRouter();
  const { isFolderTreeVisible } = useMediaContext();
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
      settings: "settings",
    };

    if (visibleStandalonePlugins.length === 0) return baseMenuItems;

    const iconMap = Icons as unknown as Record<string, React.ElementType>;

    const byAnchor = new Map<
      string,
      Array<{ item: MainMenuItem; order: number }>
    >();
    for (const sp of visibleStandalonePlugins) {
      const slug = pluginSlug(sp.name);
      // A menu item stores an ElementType rendered as `<Icon className=… />`,
      // so this surface cannot show an image. It says so rather than resolving
      // an asset and discarding it, which would also discard the lucide name a
      // plugin declared alongside the asset for precisely this surface.
      const resolved = resolvePluginIcon(sp, {
        fallback: "Database",
        allowAsset: false,
      });
      const iconName = resolved.name;
      const IconComponent = iconMap[iconName] || Database;
      // The former top-level Users icon is gone; User Management now lives
      // under Settings, so a plugin still declaring `after: "users"` is anchored
      // next to Settings instead of falling through to the end of the rail.
      const rawAnchor = sp.after || "plugins";
      const anchor = rawAnchor === "users" ? "settings" : rawAnchor;

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
  } = useSingles({
    pagination: { page: 0, pageSize: 100 },
    sorting: [],
    filters: {},
  });

  const pluginMetadata = branding?.plugins;

  const permittedCollections = useMemo(() => {
    const allCollections = collectionsData?.items ?? [];
    return filterCollectionItems(allCollections, capabilities);
  }, [collectionsData?.items, capabilities]);

  const permittedSingles = useMemo(() => {
    const allSingles = singlesData?.items ?? [];
    return filterSingleItems(allSingles, capabilities);
  }, [singlesData?.items, capabilities]);

  // Bound to this render's metadata rather than reimplemented: the rail's
  // visibility and the panel's contents must agree about where a collection
  // belongs, and two implementations of that would let the rail offer a
  // section whose destinations have all moved elsewhere.
  const getCollectionPlacement = useMemo(() => {
    return (collection: ApiCollection): string | undefined =>
      resolveCollectionPlacement(collection.name, pluginMetadata);
  }, [pluginMetadata]);

  const hasPermissionDataPending =
    !isHydrated ||
    isPermissionsLoading ||
    (!!permissionsError && permissions.length === 0);

  const hasCollectionsSection = hasCollectionsSectionHelper(capabilities, {
    isPending: hasPermissionDataPending || isCollectionsLoading,
    isError: isCollectionsError,
    permittedCollections,
    placementOf: getCollectionPlacement,
  });

  const hasSinglesSection =
    capabilities.canViewCollections &&
    (hasPermissionDataPending ||
      isSinglesLoading ||
      isSinglesError ||
      permittedSingles.some(single => !single.admin?.hidden));

  const pluginsSectionVisible = hasPluginsSection(capabilities, {
    // Loading only. A FAILED collections query is not pending: it will never
    // resolve into visible collections, and for a user without
    // `canManageSettings` the panel then has no destination at all, so keeping
    // the rail item would open an empty panel rather than defer a decision.
    isPending: hasPermissionDataPending || isCollectionsLoading,
    hasVisiblePluginCollection: hasVisiblePluginCollection(
      permittedCollections,
      getCollectionPlacement
    ),
  });

  const hasMediaSection = hasPermissionDataPending
    ? true
    : capabilities.canViewMedia;
  const canAccessApiKeys =
    hasPermission("read-api-keys") ||
    hasPermission("create-api-keys") ||
    hasPermission("update-api-keys");
  // Any webhook grant reveals the link, matching the list route: read/update
  // view the list, create reaches the create form from it.
  const canAccessWebhooks =
    hasPermission("read-webhooks") ||
    hasPermission("update-webhooks") ||
    hasPermission("create-webhooks");
  // Settings now also hosts User Management (Users, User Fields, Roles), so a
  // user whose only access is users/roles must still see the Settings icon.
  const hasSettingsSection = hasPermissionDataPending
    ? true
    : capabilities.canViewSettings ||
      capabilities.canManageEmailProviders ||
      capabilities.canManageEmailTemplates ||
      canAccessApiKeys ||
      canAccessWebhooks ||
      capabilities.canViewUsers ||
      capabilities.canViewRoles;
  const hasBuildersSection = showBuilder;

  const visibleMenuItems = useMemo(
    () =>
      filteredMenuItems.filter(item => {
        // A slug declared on the entry is a hard gate, ahead of the per-section
        // cases below: those decide whether a section has anything to SHOW,
        // which is a different question from whether the reader may see it.
        //
        // While the grants are still loading the entry is shown, matching Media
        // and Settings. The alternative flashes the rail — an item appearing a
        // moment after the page settles reads as the UI changing its mind, and
        // the destination refuses on its own anyway.
        if (item.requiredPermission && !hasPermissionDataPending) {
          // A LIST is any-of, matching the canonical declaration: that is how an
          // umbrella permission is written, and treating it as all-of would hide
          // a section from someone holding one of the grants that reaches it.
          const needed = Array.isArray(item.requiredPermission)
            ? item.requiredPermission
            : [item.requiredPermission];
          if (!needed.some(slug => hasPermission(slug))) return false;
        }
        switch (item.id) {
          case "collections":
            return hasCollectionsSection;
          case "singles":
            return hasSinglesSection;
          case "plugins":
            return pluginsSectionVisible;
          case "media":
            return hasMediaSection;
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
      hasPermission,
      hasPermissionDataPending,
      hasCollectionsSection,
      hasSinglesSection,
      pluginsSectionVisible,
      hasMediaSection,
      hasSettingsSection,
      hasBuildersSection,
    ]
  );

  const activeCategory = useMemo(
    () =>
      resolveActiveSection({
        pathname,
        from: route?.searchParams?.from,
        collections: collectionsData?.items,
        getCollectionPlacement,
        standalonePlugins: visibleStandalonePlugins,
        showBuilder,
      }) ?? "dashboard",
    [
      pathname,
      collectionsData,
      getCollectionPlacement,
      visibleStandalonePlugins,
      route,
      showBuilder,
    ]
  );

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

  // Filtering logic for plugins
  const authorizedPlugins = useMemo(() => {
    const visible = (collectionsData?.items ?? []).filter(
      c => !c.admin?.hidden && c.admin?.isPlugin
    );
    return filterCollectionItems(visible, capabilities);
  }, [collectionsData, capabilities]);

  const suppressedChrome = useSuppressedChrome();

  const hasSubSidebarCategory = (id: string) =>
    isSubSidebarCategory(id, isFolderTreeVisible);

  // The Settings icon lands on the first subpage the user can actually OPEN.
  // Read off the panel's own table rather than listed here: this chain named
  // seven destinations in an order of its own, and a destination added to the
  // table and not to the chain became unreachable from the rail. Background
  // Jobs was exactly that — the entry appeared, the link fell through every
  // arm, and a jobs-only operator landed on General Settings, which answers to
  // manage-settings and returns 403.
  const settingsHref = resolveSettingsLanding({
    hasPermission,
    canAccessApiKeys,
    canAccessWebhooks,
  });

  const resolveItemHref = (item: MainMenuItem): string =>
    resolveItemHrefHelper(
      item,
      visibleStandalonePlugins,
      settingsHref,
      capabilities.canManageSettings
    );

  // Resolve collections for the active standalone plugin section
  const pluginCollectionsForSection = useMemo(() => {
    if (!selectedMain.startsWith("standalone-")) return [];
    const slug = selectedMain.replace("standalone-", "");
    const sp = visibleStandalonePlugins.find(p => pluginSlug(p.name) === slug);
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
  const standaloneLabel = useMemo(
    () =>
      resolveStandaloneLabel(
        selectedMain,
        visibleStandalonePlugins,
        pluginSlug
      ),
    [selectedMain, visibleStandalonePlugins]
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* 1. Icon Sidebar (Main Menu) */}
      <aside
        className={cn(
          "flex flex-col items-center py-4 bg-sidebar  border-r border-border z-50",
          "w-[72px] shrink-0"
        )}
      >
        {/* Logo */}
        <Link
          href={ROUTES.DASHBOARD}
          className="mb-8 flex items-center justify-center h-10 w-10 group"
        >
          <ThemeAwareLogo
            boxed
            className="w-8 h-8 object-contain"
            alt={branding.logoText ?? "Logo"}
          />
        </Link>

        {/* Main Icons */}
        <nav className="flex-1 flex flex-col gap-4 w-full px-3">
          {visibleMenuItems.map(item => {
            const Icon = item.icon;
            const isSelected = selectedMain === item.id;
            const href = resolveItemHref(item);
            /*
             * On mobile a category normally stays put and opens the panel
             * instead of navigating. With the panel SUPPRESSED there is no
             * panel to open, so staying put does nothing at all and the drawer
             * stops navigating — the tap only moves a selection nobody can see.
             */
            const stayOnPageMobile =
              isMobile &&
              hasSubSidebarCategory(item.id) &&
              !suppressedChrome.has("subSidebar");
            const renderAsLink = href !== "#" && !stayOnPageMobile;

            // Unselected items use muted foreground so the resting icon meets contrast; a faint primary alpha did not.
            const className = cn(
              "flex items-center justify-center h-11 w-11 rounded-md transition-all duration-200 cursor-pointer relative focus:outline-none",
              isSelected
                ? // `sidebar-accent` rather than `muted`: it is the surface
                  // `sidebar-accent-foreground` is declared against. Pairing
                  // the sidebar's ink with a surface from another scale is a
                  // combination no theme declares, so the contrast suite --
                  // which asserts each token against its declared partner --
                  // never checks it, and it goes unreadable in any theme that
                  // does not happen to survive the mismatch.
                  "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover-unified"
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
                  className="bg-primary border-border text-primary-foreground"
                >
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </aside>

      {/* 2. Sub Sidebar (Detail Menu) */}
      <SubSidebarPanel
        isMobile={Boolean(isMobile)}
        selectedMain={selectedMain}
        visibleMenuItemIds={visibleMenuItems.map(item => item.id)}
        isFolderTreeVisible={isFolderTreeVisible}
        standaloneLabel={standaloneLabel}
        content={{
          selectedMain,
          standaloneLabel,
          collectionSearch,
          onCollectionSearchChange: setCollectionSearch,
          singleSearch,
          onSingleSearchChange: setSingleSearch,
          pluginSearch,
          onPluginSearchChange: setPluginSearch,
          isActive,
          hasPermission,
          canAccessApiKeys,
          canAccessWebhooks,
          pluginCollectionsForSection,
          showBuilder,
        }}
      />
    </div>
  );
}
