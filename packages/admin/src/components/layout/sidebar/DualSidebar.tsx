"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@nextlyhq/ui";
import type React from "react";
import { useCallback, useState, useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { Database } from "@admin/components/icons";
import { ThemeAwareLogo } from "@admin/components/shared/ThemeAwareLogo";
import { Link } from "@admin/components/ui/link";
import { SIDEBAR_NAVIGATION } from "@admin/constants/navigation";
import { ROUTES } from "@admin/constants/routes";
import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { useMediaContext } from "@admin/context/providers/MediaProvider";
import {
  NAV_COLLECTIONS_PARAMS,
  NAV_SINGLES_PARAMS,
  useCollections,
  useSingles,
} from "@admin/hooks/queries";
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

import {
  CONTENT_RAIL_ID,
  contentItemHref,
  contentSectionToOpen,
  panelSectionIds,
  railItemOf,
  sectionShown,
} from "./lib/content-rail";
import { hasCollectionsSection as hasCollectionsSectionHelper } from "./lib/has-collections-section";
import {
  hasPluginsSection,
  hasVisiblePluginCollection,
} from "./lib/has-plugins-section";
import {
  canAccessApiKeys,
  canAccessWebhooks,
  hasSettingsSection as hasSettingsSectionHelper,
} from "./lib/has-settings-section";
import { isSubSidebarCategory } from "./lib/has-sub-sidebar";
import {
  placeStandalonePlugins,
  standaloneEntryId,
} from "./lib/place-standalone-plugins";
import { resolveItemHref as resolveItemHrefHelper } from "./lib/resolve-item-href";
import { resolveActiveSection } from "./lib/resolve-section";
import { resolveSettingsLanding } from "./lib/resolve-settings-landing";
import { resolveStandaloneLabel } from "./lib/resolve-standalone-label";
import { settledRailItems } from "./lib/settled-rail";
import { standalonePluginsVisibleTo } from "./lib/standalone-plugins-visible-to";
import type {
  MainMenuCategory,
  MainMenuItem,
  RailItemId,
} from "./sidebar-types";
import { getFilteredMenuItems } from "./sidebar-types";
import { SubSidebarPanel } from "./SubSidebarPanel";

interface DualSidebarProps {
  isMobile?: boolean;
}

export function DualSidebar({
  isMobile,
}: DualSidebarProps = {}): React.JSX.Element {
  const { pathname, route, isHydrated } = useRouter();
  const { isFolderTreeVisible } = useMediaContext();
  const {
    capabilities,
    permissions,
    hasPermission,
    isLoading: isPermissionsLoading,
    error: permissionsError,
    content,
  } = useCurrentUserPermissions();
  const branding = useBranding();
  const { isPending: isWorkspacePending } = useBrandingStatus();
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

  const visibleStandalonePlugins = useMemo(
    () => standalonePluginsVisibleTo(standalonePlugins, capabilities),
    [standalonePlugins, capabilities]
  );

  const visibleStandaloneIds = useMemo(
    () =>
      new Set<string>(
        visibleStandalonePlugins.map(p => standaloneEntryId(pluginSlug(p.name)))
      ),
    [visibleStandalonePlugins]
  );

  // Standalone plugins take their place in the rail by the anchor they declare.
  // The placement rule lives in `lib/` with the other rail decisions; what stays
  // here is the icon resolution, which needs this module's icon registry. EVERY
  // standalone plugin is placed, and the reader's access decides below whether
  // its entry shows: the rail then knows where an entry would go before the
  // answer that decides it arrives, so it can hold the entries after it back.
  const filteredMenuItems = useMemo(() => {
    const iconMap = Icons as unknown as Record<string, React.ElementType>;
    return placeStandalonePlugins(baseMenuItems, standalonePlugins, {
      slugOf: pluginSlug,
      iconFor: plugin => {
        // A menu item stores an ElementType rendered as `<Icon className=… />`,
        // so this surface cannot show an image. It says so rather than
        // resolving an asset and discarding it, which would also discard the
        // lucide name a plugin declared alongside the asset for this surface.
        const resolved = resolvePluginIcon(plugin, {
          fallback: "Database",
          allowAsset: false,
        });
        return iconMap[resolved.name] || Database;
      },
    });
  }, [baseMenuItems, standalonePlugins]);

  // Fetch data for automatic navigation. The shared params keep these on the
  // cache entries the browser tab's title reads its labels from, so naming a
  // collection or Single in the tab costs no request of its own.
  const {
    data: collectionsData,
    isLoading: isCollectionsLoading,
    isError: isCollectionsError,
  } = useCollections(NAV_COLLECTIONS_PARAMS);

  const {
    data: singlesData,
    isLoading: isSinglesLoading,
    isError: isSinglesError,
  } = useSingles(NAV_SINGLES_PARAMS);

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
  // The content sections are decided by the server's answer about collections
  // and Singles alone, so they wait on that answer and not on the permission
  // list: a list that failed would otherwise keep them pending for good.
  const contentAnswerPending = !isHydrated || content.isLoading;

  const hasCollectionsSection = hasCollectionsSectionHelper(capabilities, {
    isPending: contentAnswerPending || isCollectionsLoading,
    isError: isCollectionsError,
    permittedCollections,
    placementOf: getCollectionPlacement,
  });

  const hasSinglesSection =
    capabilities.canViewCollections &&
    (contentAnswerPending ||
      isSinglesLoading ||
      isSinglesError ||
      permittedSingles.some(single => !single.admin?.hidden));

  const pluginsSectionVisible = hasPluginsSection(capabilities, {
    // Loading only. A FAILED collections query is not pending: it will never
    // resolve into visible collections, and for a user without
    // `canManageSettings` the panel then has no destination at all, so keeping
    // the rail item would open an empty panel rather than defer a decision.
    isPending: contentAnswerPending || isCollectionsLoading,
    hasVisiblePluginCollection: hasVisiblePluginCollection(
      permittedCollections,
      getCollectionPlacement
    ),
  });

  // Shown while the grants are still resolving, like the rest of the rail. The
  // alternative flashes: an entry appearing a moment after the page settles
  // reads as the UI changing its mind, and the media route refuses on its own.
  const hasMediaSection = hasPermissionDataPending
    ? true
    : capabilities.canViewMedia;
  const apiKeysReachable = canAccessApiKeys(hasPermission);
  const webhooksReachable = canAccessWebhooks(hasPermission);
  const hasSettingsSection = hasSettingsSectionHelper(capabilities, {
    isPending: hasPermissionDataPending,
    hasPermission,
  });
  const hasBuildersSection = showBuilder;

  // Whether an entry shows, with an answer still loading read as "shown" for
  // the entries that say so below. The panel and the routes read this; what the
  // rail DRAWS is held to the entries already decided (`railItems`).
  const isMenuItemShown = useCallback(
    (item: MainMenuItem): boolean => {
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
      // A plugin's own entry shows by the access its plugin asks for.
      if (item.id.startsWith("standalone-")) {
        return visibleStandaloneIds.has(item.id);
      }
      switch (item.id) {
        case CONTENT_RAIL_ID:
          // Shown while either kind has something to list; the panel shows
          // only the kinds that do.
          return hasCollectionsSection || hasSinglesSection;
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
    },
    [
      visibleStandaloneIds,
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

  const visibleMenuItems = useMemo(
    () => filteredMenuItems.filter(isMenuItemShown),
    [filteredMenuItems, isMenuItemShown]
  );

  // What the rail draws: the entries shown, up to the first one whose answer
  // has not arrived. An entry arriving later then lands below every entry
  // already drawn instead of pushing them down. Loading counts here, a failed
  // answer does not: a failure is decided until a retry, and the visibility
  // rule above already says what it shows.
  const railItems = useMemo(
    () =>
      settledRailItems(filteredMenuItems, isMenuItemShown, {
        workspace: isWorkspacePending,
        permissions: !isHydrated || isPermissionsLoading,
        content:
          contentAnswerPending || isCollectionsLoading || isSinglesLoading,
      }),
    [
      filteredMenuItems,
      isMenuItemShown,
      isWorkspacePending,
      isHydrated,
      isPermissionsLoading,
      contentAnswerPending,
      isCollectionsLoading,
      isSinglesLoading,
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
  // Which content kinds the reader can see now, read by every content decision
  // below so none can answer from a different pair.
  const contentAvailable = {
    collections: hasCollectionsSection,
    singles: hasSinglesSection,
  };
  // What the sidebar shows for the selection, which may give way to the other
  // content kind once the lists settle.
  const shownMain = sectionShown(selectedMain, contentAvailable);

  // One search for both content kinds: it carries over when the Content panel
  // switches between Collections and Singles.
  const [contentSearch, setContentSearch] = useState("");
  const [pluginSearch, setPluginSearch] = useState("");

  /**
   * Open a rail item's panel. Content opens on the part already showing, or
   * on Collections, or on Singles when the reader has no collections to list.
   */
  const selectRailItem = (id: RailItemId) => {
    if (id !== CONTENT_RAIL_ID) {
      setSelectedMain(id);
      return;
    }
    setSelectedMain(contentSectionToOpen(selectedMain, contentAvailable));
  };

  // Follows the route: a navigation selects the section it lands in. Adjusted during render
  // rather than in an effect, since an effect runs after the paint, so the page arrived at was
  // first drawn beside the previous section's panel, and the whole content area moved as that
  // panel closed a frame later.
  const [routedCategory, setRoutedCategory] = useState(activeCategory);
  if (routedCategory !== activeCategory) {
    setRoutedCategory(activeCategory);
    setSelectedMain(activeCategory);
  }

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
    canAccessApiKeys: apiKeysReachable,
    canAccessWebhooks: webhooksReachable,
  });

  const resolveItemHref = (item: MainMenuItem): string =>
    resolveItemHrefHelper(
      item,
      visibleStandalonePlugins,
      settingsHref,
      capabilities.canManageSettings,
      contentItemHref({
        panelShown: !suppressedChrome.has("subSidebar"),
        current: shownMain,
        available: contentAvailable,
      })
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
          {railItems.map(item => {
            const Icon = item.icon;
            const isSelected = railItemOf(shownMain) === item.id;
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
                      onClick={() => selectRailItem(item.id)}
                      className={className}
                      data-active={isSelected}
                      // Named for assistive technology: it draws an icon alone, and its tooltip
                      // is shown on hover and does not name the control.
                      aria-label={item.label}
                    >
                      {iconContent}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => selectRailItem(item.id)}
                      className={className}
                      data-active={isSelected}
                      // Named as the link beside it is: an icon alone, with a tooltip that does
                      // not name the control.
                      aria-label={item.label}
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
        selectedMain={shownMain}
        visibleMenuItemIds={panelSectionIds(
          visibleMenuItems.map(item => item.id),
          contentAvailable
        )}
        isFolderTreeVisible={isFolderTreeVisible}
        standaloneLabel={standaloneLabel}
        content={{
          selectedMain: shownMain,
          standaloneLabel,
          contentSearch,
          onContentSearchChange: setContentSearch,
          hasCollectionsSection,
          hasSinglesSection,
          pluginSearch,
          onPluginSearchChange: setPluginSearch,
          isActive,
          hasPermission,
          canAccessApiKeys: apiKeysReachable,
          canAccessWebhooks: webhooksReachable,
          pluginCollectionsForSection,
          showBuilder,
        }}
      />
    </div>
  );
}
