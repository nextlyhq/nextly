"use client";

/**
 * Smart redirect router for `/admin/collections`.
 *
 * Lands the user on the FIRST collection the sidebar would render in
 * its "Collections" section (matching pinned → admin.order → name asc
 * sort). This guarantees WYSIWYG behaviour: the redirect target is
 * always the same as the sidebar's top item, and the choice of
 * "default" collection is something the user controls (by pinning or
 * setting `admin.order`) rather than something derived from a
 * non-obvious createdAt order.
 *
 * Renders an empty-state component (with a CTA pointing at the
 * collection builder) when zero collections are visible to the current
 * user. The previous behaviour (NotFoundPage) was confusing — a fresh
 * install showing 404 looked broken.
 */

import { useEffect } from "react";

import { EmptyEntitiesState } from "@admin/components/features/dashboard/EmptyEntitiesState";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCollections } from "@admin/hooks/queries/useCollections";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useSidebarPins } from "@admin/hooks/useSidebarPins";
import { navigateTo } from "@admin/lib/navigation";
import { pickCollectionsLandingTarget } from "@admin/lib/sidebar-landing";

// Same key as DynamicCollectionNav — they MUST share the pinned set.
const PINNED_COLLECTIONS_STORAGE_KEY = "nextly:sidebar:pinned-collections";

export default function CollectionsLandingRedirect() {
  const branding = useBranding();
  const { capabilities } = useCurrentUserPermissions();
  const { pinned: pinnedCollections } = useSidebarPins({
    storageKey: PINNED_COLLECTIONS_STORAGE_KEY,
  });
  // Match the sidebar's fetch params so we sort the same set of items.
  const { data, isLoading } = useCollections({
    pagination: { page: 0, pageSize: 100 },
    sorting: [{ field: "name", direction: "asc" }],
  });

  const target = pickCollectionsLandingTarget(data?.items ?? [], {
    branding,
    capabilities,
    pinnedCollections,
  });
  const targetSlug = target?.name;

  useEffect(() => {
    if (!isLoading && targetSlug) {
      navigateTo(`/admin/collections/${targetSlug}`);
    }
  }, [isLoading, targetSlug]);

  if (isLoading || targetSlug) {
    return <div className="h-32" aria-hidden="true" />;
  }

  return <EmptyEntitiesState type="collection" />;
}
