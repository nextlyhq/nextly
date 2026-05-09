"use client";

/**
 * Smart redirect router for `/admin/singles`. Mirrors
 * `CollectionsLandingRedirect`: lands the user on the FIRST single
 * the sidebar would render in its "Singles" section (pinned →
 * admin.order → name asc). Empty state instead of 404 when none
 * exist.
 */

import { useEffect } from "react";

import { EmptyEntitiesState } from "@admin/components/features/dashboard/EmptyEntitiesState";
import { useSingles } from "@admin/hooks/queries/useSingles";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useSidebarPins } from "@admin/hooks/useSidebarPins";
import { navigateTo } from "@admin/lib/navigation";
import { pickSinglesLandingTarget } from "@admin/lib/sidebar-landing";

// Same key as DynamicSingleNav — they MUST share the pinned set.
const PINNED_SINGLES_STORAGE_KEY = "nextly:sidebar:pinned-singles";

export default function SinglesLandingRedirect() {
  const { capabilities } = useCurrentUserPermissions();
  const { pinned: pinnedSingles } = useSidebarPins({
    storageKey: PINNED_SINGLES_STORAGE_KEY,
  });
  const { data, isLoading } = useSingles();

  const target = pickSinglesLandingTarget(data?.items ?? [], {
    capabilities,
    pinnedSingles,
  });
  const targetSlug = target?.slug;

  useEffect(() => {
    if (!isLoading && targetSlug) {
      navigateTo(`/admin/singles/${targetSlug}`);
    }
  }, [isLoading, targetSlug]);

  if (isLoading || targetSlug) {
    return <div className="h-32" aria-hidden="true" />;
  }

  return <EmptyEntitiesState type="single" />;
}
