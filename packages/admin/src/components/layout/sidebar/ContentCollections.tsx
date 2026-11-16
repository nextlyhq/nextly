"use client";

/**
 * What the Content panel lists under Collections: each `admin.sidebarGroup`
 * under a sub-heading of its own, its collections indented under it, in the
 * order its first collection appears; then the collections that name no
 * group, with the plugin menu items placed in Collections.
 *
 * @module components/layout/sidebar/ContentCollections
 */
import type { JSX } from "react";

import { DynamicCollectionNav } from "@admin/components/features/dashboard/DynamicCollectionNav";
import { PluginMenuItems } from "@admin/components/features/dashboard/PluginMenuItems";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { groupCollections } from "@admin/lib/content-groups";
import type { ApiCollection } from "@admin/types/entities";

import { ContentFold } from "./ContentFold";
import { groupFoldKey, type ContentFolds } from "./lib/content-folds";

import { SidebarMenu } from "./index";

export function ContentCollections({
  matched,
  pluginMatches,
  loading,
  search,
  isActive,
  folds,
}: {
  /** The collections the search matched, in the sidebar's order. */
  matched: readonly ApiCollection[];
  /** How many plugin menu items placed in Collections the search matched. */
  pluginMatches: number;
  /** Whether the collections are still loading. */
  loading: boolean;
  search: string;
  isActive: (href?: string) => boolean;
  folds: ContentFolds;
}): JSX.Element {
  const branding = useBranding();
  const groups = groupCollections(matched, branding.customGroups);
  const hasUngrouped = groups.at(-1)?.slug === null;
  return (
    <>
      {groups.flatMap(group =>
        group.slug === null
          ? []
          : [
              <ContentFold
                key={group.slug}
                foldKey={groupFoldKey(group.slug)}
                label={group.name}
                level="group"
                folds={folds}
              >
                <SidebarMenu>
                  <DynamicCollectionNav
                    isActive={isActive}
                    search={search}
                    group={group.slug}
                  />
                </SidebarMenu>
              </ContentFold>,
            ]
      )}
      {/* The list draws its loading rows itself, so it shows while loading
          too; otherwise only when it has something, as an empty list is
          still announced as one. */}
      {loading || hasUngrouped || pluginMatches > 0 ? (
        <SidebarMenu>
          <DynamicCollectionNav isActive={isActive} search={search} />
          <PluginMenuItems
            isActive={isActive}
            section="collections"
            search={search}
          />
        </SidebarMenu>
      ) : null}
    </>
  );
}
