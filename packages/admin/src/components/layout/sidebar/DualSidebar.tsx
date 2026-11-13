"use client";

import type React from "react";
import { useCallback, useState, useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { Database } from "@admin/components/icons";
import { SIDEBAR_NAVIGATION } from "@admin/constants/navigation";
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
  isMultilingual,
  type LocalizationConfig,
} from "@admin/lib/localization";
import {
  filterCollectionItems,
  filterSingleItems,
} from "@admin/lib/permissions/authorization";
import { resolveCollectionPlacement } from "@admin/lib/plugins/collection-placement";
import { resolveVisibleMenuItems } from "@admin/lib/plugins/menu";
import { pluginSettingsLinks } from "@admin/lib/plugins/plugin-settings-permission";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import { resolvePluginIcon } from "@admin/lib/plugins/resolve-plugin-icon";
import type { ApiCollection } from "@admin/types/entities";

import { useSuppressedChrome } from "../ChromeSuppression";

import {
  CONTENT_RAIL_ID,
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
import { KeepSidebarMenu } from "./lib/remembered-menu";
import { resolveItemHref as resolveItemHrefHelper } from "./lib/resolve-item-href";
import { resolveActiveSection } from "./lib/resolve-section";
import { resolveSettingsLanding } from "./lib/resolve-settings-landing";
import { resolveStandaloneLabel } from "./lib/resolve-standalone-label";
import {
  railAnswersIn,
  railAnswersPending,
  settledRailItems,
} from "./lib/settled-rail";
import { standalonePluginCollections } from "./lib/standalone-plugin-collections";
import { standalonePluginsVisibleTo } from "./lib/standalone-plugins-visible-to";
import { RailAccount } from "./RailAccount";
import { RailColumn, RailEntry, RailGhostItems } from "./RailColumn";
import type {
  MainMenuCategory,
  MainMenuItem,
  RailItemId,
} from "./sidebar-types";
import { getFilteredMenuItems } from "./sidebar-types";
import { SubSidebarPanel } from "./SubSidebarPanel";

/** Whether each rail entry's section has something to show, keyed by entry id. */
type RailSections = Readonly<Record<string, boolean>>;

/**
 * Whether a rail entry's section has anything to show. An entry with no
 * section of its own (Dashboard, Releases) always has.
 */
function sectionHasContent(id: string, sections: RailSections): boolean {
  return sections[id] ?? true;
}

/** What each rail entry's section holds, as the rail's own answers give it. */
interface RailSectionAnswers {
  hasCollectionsSection: boolean;
  hasSinglesSection: boolean;
  pluginsSectionVisible: boolean;
  hasMediaSection: boolean;
  hasSettingsSection: boolean;
  hasBuildersSection: boolean;
  branding: { locales?: LocalizationConfig } | null | undefined;
}

/**
 * Whether each rail entry's section has anything to show, by the entry's id.
 * Six booleans, cheap enough to build on every render.
 */
function railSections(answers: RailSectionAnswers): RailSections {
  return {
    // Shown while either kind has something to list; the panel shows only the
    // kinds that do.
    [CONTENT_RAIL_ID]:
      answers.hasCollectionsSection || answers.hasSinglesSection,
    plugins: answers.pluginsSectionVisible,
    media: answers.hasMediaSection,
    settings: answers.hasSettingsSection,
    builders: answers.hasBuildersSection,
    // Only a site with two or more locales has anything to translate.
    translations: isMultilingual(answers.branding?.locales),
  };
}

/**
 * Whether a rail entry navigates (a link) rather than only opening its panel
 * (a button). On mobile a category normally stays put and opens the panel
 * instead of navigating. With the panel SUPPRESSED there is no panel to open,
 * so staying put would do nothing at all and the drawer would stop navigating:
 * the tap would only move a selection nobody can see.
 */
function railEntryNavigates(entry: {
  href: string;
  isMobile: boolean;
  opensPanel: boolean;
  panelReleased: boolean;
}): boolean {
  const staysOnPage =
    entry.isMobile && entry.opensPanel && !entry.panelReleased;
  return entry.href !== "#" && !staysOnPage;
}

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

  /**
   * Whether a section other than Plugins draws a panel this reader can open:
   * it has one at all, and its rail entry shows to them. A plugin menu item
   * whose own section fails this is listed under Plugins instead, so every
   * item the reader may open is reachable.
   */
  const sectionReachable = (section: string): boolean => {
    if (!isSubSidebarCategory(section, isFolderTreeVisible)) return false;
    if (section.startsWith("standalone-")) {
      return visibleStandaloneIds.has(section);
    }
    switch (section) {
      case "collections":
        return hasCollectionsSection;
      case "singles":
        return hasSinglesSection;
      case "media":
        return hasMediaSection;
      case "settings":
        return hasSettingsSection;
      case "builders":
        return hasBuildersSection;
      default:
        return false;
    }
  };

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
    // A plugin's own menu item the reader may open is a destination of the
    // panel too, a page with no collection beside it included.
    hasVisibleMenuItem:
      resolveVisibleMenuItems(
        branding?.plugins,
        hasPermission,
        "plugins",
        sectionReachable
      ).length > 0,
    // A plugin settings page a role of the plugin's own may open, which only
    // this panel links to: the panel's own function, so the rail shows the
    // entry exactly when the panel draws the link.
    hasReachablePluginSettings:
      pluginSettingsLinks(branding?.plugins, {
        canManageSettings: capabilities.canManageSettings,
        hasPermission,
      }).length > 0,
  });

  // Whether an entry shows, with an answer still loading read as "shown" for
  // the entries that say so below. The panel and the routes read this; what the
  // rail DRAWS is held to the entries already decided (`rail.items`).
  const sections = railSections({
    hasCollectionsSection,
    hasSinglesSection,
    pluginsSectionVisible,
    hasMediaSection,
    hasSettingsSection,
    hasBuildersSection,
    branding,
  });

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
      return sectionHasContent(item.id, sections);
    },
    [visibleStandaloneIds, hasPermission, hasPermissionDataPending, sections]
  );

  const visibleMenuItems = useMemo(
    () => filteredMenuItems.filter(isMenuItemShown),
    [filteredMenuItems, isMenuItemShown]
  );

  // What the rail draws: the entries shown, up to the first one whose answer
  // has not arrived. An entry arriving later then lands below every entry
  // already drawn instead of pushing them down. And whether every answer is
  // in, which the rail marks for a reader of the page.
  const rail = useMemo(() => {
    const pending = railAnswersPending({
      workspacePending: isWorkspacePending,
      hydrated: isHydrated,
      permissionsLoading: isPermissionsLoading,
      contentAnswerPending,
      collectionsLoading: isCollectionsLoading,
      singlesLoading: isSinglesLoading,
    });
    return {
      items: settledRailItems(filteredMenuItems, isMenuItemShown, pending),
      settled: railAnswersIn(pending),
    };
  }, [
    filteredMenuItems,
    isMenuItemShown,
    isWorkspacePending,
    isHydrated,
    isPermissionsLoading,
    contentAnswerPending,
    isCollectionsLoading,
    isSinglesLoading,
  ]);

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

  const suppressedChrome = useSuppressedChrome();

  const hasSubSidebarCategory = (id: string) =>
    isSubSidebarCategory(id, isFolderTreeVisible);

  // The Settings icon lands on the first subpage the user can actually OPEN.
  // Read off the panel's own table rather than listed here: this chain named
  // seven destinations in an order of its own, and a destination added to the
  // table and not to the chain became unreachable from the rail. Background
  // Jobs was exactly that — the entry appeared, the link fell through every
  // arm, and a jobs-only operator landed on General Settings, which answers to
  // manage-settings and returns 403. The Settings crumb of the pages inside
  // the panel asks the same function (`useSettingsLanding`), so the two
  // cannot disagree.
  const settingsHref = resolveSettingsLanding({
    hasPermission,
    canAccessApiKeys: apiKeysReachable,
    canAccessWebhooks: webhooksReachable,
  });

  const resolveItemHref = (item: MainMenuItem): string =>
    resolveItemHrefHelper(
      item,
      visibleStandalonePlugins,
      // The panel's own inputs, so a rail item opens what its panel lists.
      {
        collections: collectionsData?.items ?? [],
        capabilities,
        can: hasPermission,
      },
      settingsHref,
      capabilities.canManageSettings
    );

  // Resolve collections for the active standalone plugin section, by the same
  // function its rail item's landing reads, so the two agree on the first.
  const pluginCollectionsForSection = useMemo(() => {
    if (!selectedMain.startsWith("standalone-")) return [];
    const slug = selectedMain.replace("standalone-", "");
    const sp = visibleStandalonePlugins.find(p => pluginSlug(p.name) === slug);
    if (!sp) return [];
    return standalonePluginCollections(
      sp,
      collectionsData?.items ?? [],
      capabilities
    );
  }, [
    selectedMain,
    visibleStandalonePlugins,
    collectionsData?.items,
    capabilities,
  ]);

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
      {/* The navigation as this reader sees it, kept on the device once every
          answer the rail draws from is in, so the next fresh tab draws it
          before the server answers. */}
      <KeepSidebarMenu
        settled={rail.settled}
        items={rail.items}
        hrefOf={resolveItemHref}
        standalonePlugins={visibleStandalonePlugins}
        parts={contentAvailable}
      />
      {/* 1. Icon Sidebar (Main Menu) */}
      <RailColumn
        settled={rail.settled}
        // The rail's foot: the reader's Inbox and account menu, the same on
        // every page.
        foot={<RailAccount className="mt-4 shrink-0" />}
      >
        {rail.items.map(item => {
          const href = resolveItemHref(item);
          return (
            <RailEntry
              key={item.id}
              label={item.label}
              icon={item.icon}
              href={href}
              selected={railItemOf(shownMain) === item.id}
              asLink={railEntryNavigates({
                href,
                isMobile: Boolean(isMobile),
                opensPanel: hasSubSidebarCategory(item.id),
                panelReleased: suppressedChrome.has("subSidebar"),
              })}
              onSelect={() => selectRailItem(item.id)}
            />
          );
        })}
        {/* While the answers that decide the rest are out, neutral shapes
            hold their places, so the rail never reads as empty; the entries
            replace them where they stand. */}
        {rail.settled ? null : (
          <RailGhostItems
            from={rail.items.length}
            count={filteredMenuItems.length - rail.items.length}
          />
        )}
      </RailColumn>

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
          hasPanel: sectionReachable,
        }}
      />
    </div>
  );
}
