"use client";

/**
 * The dashboard header's New split button, fed by what the reader may create,
 * the types they created last (kept on the server, so every device agrees) and
 * the sidebar's own order.
 *
 * @module components/features/dashboard/header/NewSplitButton
 */
import type { JSX } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useDashboardNewTypes } from "@admin/hooks/queries/useDashboardNewTypes";
import { useCreatableCollections } from "@admin/hooks/useCreatableCollections";
import { useSidebarCollectionList } from "@admin/hooks/useSidebarContentLists";

import { newMenu } from "./new-menu-model";
import {
  NewSplitButtonPlaceholder,
  NewSplitButtonView,
} from "./NewSplitButtonView";

export function NewSplitButton(): JSX.Element | null {
  const { collections, isReady, failed } = useCreatableCollections();
  // A failed read of the recent types leaves the main part on the first type
  // in sidebar order: recent types are a convenience, never a gate.
  const { data: recentSlugs, isPending: recentPending } =
    useDashboardNewTypes();
  const { items: sidebarCollections } = useSidebarCollectionList();
  const branding = useBranding();
  const menu = newMenu({
    creatable: collections,
    recentSlugs: recentSlugs ?? [],
    sidebarCollections,
    customGroups: branding?.customGroups,
    plugins: branding?.plugins,
  });
  // Until what New leads with is known (the types the reader may create, and
  // the ones they made last), its place is held at its own size, so it is
  // drawn where it stays rather than pushing Customize aside when it arrives.
  if ((!isReady && !failed) || recentPending) {
    return <NewSplitButtonPlaceholder />;
  }
  return <NewSplitButtonView menu={menu} />;
}
